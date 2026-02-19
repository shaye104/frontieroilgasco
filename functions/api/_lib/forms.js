import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema, getEmployeeByDiscordUserId } from './db.js';

export const ALLOWED_QUESTION_TYPES = new Set([
  'short_text',
  'long_text',
  'multiple_choice',
  'multiple_select',
  'dropdown',
  'number',
  'date',
  'yes_no'
]);

export async function requireAuthenticated(context) {
  const session = await readSessionFromRequest(context.env, context.request);
  if (!session) return { errorResponse: json({ error: 'Authentication required.' }, 401), session: null, employee: null };

  try {
    await ensureCoreSchema(context.env);
  } catch (error) {
    return { errorResponse: json({ error: error.message || 'Database unavailable.' }, 500), session: null, employee: null };
  }

  const employee = await getEmployeeByDiscordUserId(context.env, session.userId);
  return { errorResponse: null, session, employee };
}

export function normalizeQuestion(input, index = 0) {
  const label = String(input?.label || '').trim();
  const questionType = String(input?.questionType || input?.type || '').trim();
  if (!label) throw new Error(`Question ${index + 1}: label is required.`);
  if (!ALLOWED_QUESTION_TYPES.has(questionType)) {
    throw new Error(`Question ${index + 1}: unsupported type \"${questionType}\".`);
  }

  const isRequired = Boolean(input?.isRequired || input?.required);
  const helpText = String(input?.helpText || '').trim();
  const sortOrder = Number.isFinite(Number(input?.sortOrder)) ? Number(input.sortOrder) : index;

  let options = [];
  if (questionType === 'multiple_choice' || questionType === 'multiple_select' || questionType === 'dropdown') {
    options = Array.isArray(input?.options)
      ? input.options.map((value) => String(value || '').trim()).filter(Boolean)
      : String(input?.options || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);

    if (!options.length) throw new Error(`Question ${index + 1}: options are required for ${questionType}.`);
  }

  return {
    label,
    questionType,
    isRequired,
    helpText,
    options,
    sortOrder
  };
}

export function normalizeIdList(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);

  return [...new Set(source.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))];
}

export function normalizeRoleList(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);

  return [...new Set(source.map((v) => String(v).trim()).filter((v) => /^\d{6,30}$/.test(v)))];
}

export async function saveFormRelations(env, formId, payload) {
  const questions = Array.isArray(payload?.questions) ? payload.questions.map((q, i) => normalizeQuestion(q, i)) : [];
  const allowedEmployeeIds = normalizeIdList(payload?.allowedEmployeeIds || payload?.allowedEmployees);
  const allowedRoleIds = normalizeRoleList(payload?.allowedRoleIds || payload?.allowedRoles);

  const statements = [
    env.DB.prepare('DELETE FROM form_questions WHERE form_id = ?').bind(formId),
    env.DB.prepare('DELETE FROM form_access_employees WHERE form_id = ?').bind(formId),
    env.DB.prepare('DELETE FROM form_access_roles WHERE form_id = ?').bind(formId)
  ];

  questions.forEach((question) => {
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO form_questions (form_id, label, question_type, is_required, help_text, options_json, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          formId,
          question.label,
          question.questionType,
          question.isRequired ? 1 : 0,
          question.helpText,
          question.options.length ? JSON.stringify(question.options) : null,
          question.sortOrder
        )
    );
  });

  allowedEmployeeIds.forEach((employeeId) => {
    statements.push(env.DB.prepare('INSERT INTO form_access_employees (form_id, employee_id) VALUES (?, ?)').bind(formId, employeeId));
  });

  allowedRoleIds.forEach((roleId) => {
    statements.push(env.DB.prepare('INSERT INTO form_access_roles (form_id, role_id) VALUES (?, ?)').bind(formId, roleId));
  });

  await env.DB.batch(statements);
}

export async function getFormDetail(env, formId) {
  const form = await env.DB
    .prepare(
      `SELECT f.id, f.title, f.description, f.instructions, f.category_id, f.status, f.created_by, f.created_at, f.updated_at,
              c.name AS category_name
       FROM forms f
       LEFT JOIN form_categories c ON c.id = f.category_id
       WHERE f.id = ?`
    )
    .bind(formId)
    .first();

  if (!form) return null;

  const questionsResult = await env.DB
    .prepare(
      `SELECT id, label, question_type, is_required, help_text, options_json, sort_order
       FROM form_questions
       WHERE form_id = ?
       ORDER BY sort_order ASC, id ASC`
    )
    .bind(formId)
    .all();

  const employeeAccessResult = await env.DB
    .prepare('SELECT employee_id FROM form_access_employees WHERE form_id = ? ORDER BY employee_id ASC')
    .bind(formId)
    .all();

  const roleAccessResult = await env.DB
    .prepare('SELECT role_id FROM form_access_roles WHERE form_id = ? ORDER BY role_id ASC')
    .bind(formId)
    .all();

  return {
    form,
    questions: (questionsResult?.results || []).map((row) => ({
      id: row.id,
      label: row.label,
      questionType: row.question_type,
      isRequired: Boolean(row.is_required),
      helpText: row.help_text || '',
      options: row.options_json ? JSON.parse(row.options_json) : [],
      sortOrder: row.sort_order
    })),
    allowedEmployeeIds: (employeeAccessResult?.results || []).map((row) => row.employee_id),
    allowedRoleIds: (roleAccessResult?.results || []).map((row) => row.role_id)
  };
}

export function questionAnswerIsEmpty(questionType, value) {
  if (value === null || value === undefined) return true;
  if (questionType === 'multiple_select') return !Array.isArray(value) || value.length === 0;
  if (questionType === 'yes_no') return !(value === true || value === false || value === 'true' || value === 'false');
  const text = String(value).trim();
  return text.length === 0;
}
