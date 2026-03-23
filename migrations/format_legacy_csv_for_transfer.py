#!/usr/bin/env python3
import csv
import datetime as dt
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent
OUT_DIR = BASE / 'transfer-ready'


def clean(value):
    return (value or '').strip()


def parse_date_ddmmyyyy(value):
    text = clean(value)
    if not text:
        return ''
    return dt.datetime.strptime(text, '%d-%m-%Y').date().isoformat()


def parse_int(value):
    text = clean(value)
    if not text:
        return ''
    if not re.match(r'^\s*-?\d[\d.,\s]*\s*[fƒ]?\s*$', text, flags=re.IGNORECASE):
        return ''
    # Keep only numeric/sign separators, then normalize to integer florins.
    text = re.sub(r'[^0-9,.-]+', '', text)
    if not text:
        return ''
    has_dot = '.' in text
    has_comma = ',' in text
    if has_dot and has_comma:
        text = text.replace('.', '').replace(',', '.')
    elif has_dot and not has_comma:
        # In source CSV, dot is used as thousands separator (e.g. 22.975ƒ)
        text = text.replace('.', '')
    else:
        text = text.replace(',', '.')
    try:
        number = float(text)
    except ValueError:
        return ''
    return str(int(round(number)))


def normalize_crew(raw_crew):
    crew = [part.strip() for part in clean(raw_crew).split(',') if part.strip()]
    return ' | '.join(crew)


def is_cancelled(revenue_value):
    return 'cancelled' in clean(revenue_value).lower()


def write_csv(path, fieldnames, rows):
    with path.open('w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def load_rows(path):
    with path.open('r', newline='', encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


def format_history():
    src = BASE / 'Fishy Business Logger - History.csv'
    dst = OUT_DIR / 'voyage_history_transfer_ready.csv'
    rows = load_rows(src)
    out = []
    for idx, row in enumerate(rows, start=2):
        if not any(clean(v) for v in row.values()):
            continue

        revenue_raw = clean(row.get('Revenue'))
        profit_raw = clean(row.get('Profit'))
        loss_raw = clean(row.get('Loss'))
        crew_raw = clean(row.get('Crew'))

        # Legacy cancelled rows sometimes shifted crew into Loss and left Crew empty.
        if is_cancelled(revenue_raw) and loss_raw and not crew_raw and parse_int(loss_raw) == '':
            crew_raw = loss_raw
            loss_raw = ''

        out.append({
            'source_row': idx,
            'record_date': parse_date_ddmmyyyy(row.get('Date')),
            'etd_time': clean(row.get('ETD')),
            'voyage_id': clean(row.get('Voyage ID')),
            'skipper_username': clean(row.get('Skipper')),
            'arrival_port': clean(row.get('Arrival')),
            'status': 'CANCELLED' if is_cancelled(revenue_raw) else 'COMPLETED',
            'revenue_florins': parse_int(revenue_raw),
            'profit_florins': parse_int(profit_raw),
            'loss_florins': parse_int(loss_raw),
            'crew_usernames': normalize_crew(crew_raw),
        })

    write_csv(
        dst,
        [
            'source_row',
            'record_date',
            'etd_time',
            'voyage_id',
            'skipper_username',
            'arrival_port',
            'status',
            'revenue_florins',
            'profit_florins',
            'loss_florins',
            'crew_usernames',
        ],
        out,
    )


def format_salaries():
    src = BASE / 'Fishy Business Logger - Salaries.csv'
    dst = OUT_DIR / 'voyage_salaries_transfer_ready.csv'
    rows = load_rows(src)
    out = []
    for idx, row in enumerate(rows, start=2):
        if not any(clean(v) for v in row.values()):
            continue
        out.append({
            'source_row': idx,
            'record_date': parse_date_ddmmyyyy(row.get('Date')),
            'voyage_id': clean(row.get('Voyage ID')),
            'recipient_username': clean(row.get('To')),
            'revenue_florins': parse_int(row.get('Revenue')),
            'salary_florins': parse_int(row.get('Salary')),
            'catch_summary': clean(row.get('Catch')),
        })

    write_csv(
        dst,
        [
            'source_row',
            'record_date',
            'voyage_id',
            'recipient_username',
            'revenue_florins',
            'salary_florins',
            'catch_summary',
        ],
        out,
    )


def format_solved_finances():
    src = BASE / 'Fishy Business Logger - Solved Finances.csv'
    dst = OUT_DIR / 'finance_solved_transfer_ready.csv'
    rows = load_rows(src)
    out = []
    for idx, row in enumerate(rows, start=2):
        if not any(clean(v) for v in row.values()):
            continue
        out.append({
            'source_row': idx,
            'record_date': parse_date_ddmmyyyy(row.get('Date')),
            'voyage_id': clean(row.get('Voyage ID')),
            'entry_type': clean(row.get('Type')),
            'from_username': clean(row.get('From')),
            'to_username': clean(row.get('To')),
            'amount_florins': parse_int(row.get('Amount')),
            'notes': clean(row.get('Notes')),
            'solved_by_username': clean(row.get('Solved by')),
            'status': 'SOLVED',
        })

    write_csv(
        dst,
        [
            'source_row',
            'record_date',
            'voyage_id',
            'entry_type',
            'from_username',
            'to_username',
            'amount_florins',
            'notes',
            'solved_by_username',
            'status',
        ],
        out,
    )


def format_unsolved_finances():
    src = BASE / 'Fishy Business Logger - Unsolved Finances.csv'
    dst = OUT_DIR / 'finance_unsolved_transfer_ready.csv'
    rows = load_rows(src)
    out = []
    for idx, row in enumerate(rows, start=2):
        if not any(clean(v) for v in row.values()):
            continue
        out.append({
            'source_row': idx,
            'record_date': parse_date_ddmmyyyy(row.get('Date')),
            'voyage_id': clean(row.get('Voyage ID')),
            'entry_type': clean(row.get('Type')),
            'from_username': clean(row.get('From')),
            'to_username': clean(row.get('To')),
            'amount_florins': parse_int(row.get('Amount')),
            'notes': clean(row.get('Notes')),
            'solved_by_username': '',
            'status': 'UNSOLVED',
        })

    write_csv(
        dst,
        [
            'source_row',
            'record_date',
            'voyage_id',
            'entry_type',
            'from_username',
            'to_username',
            'amount_florins',
            'notes',
            'solved_by_username',
            'status',
        ],
        out,
    )


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    format_history()
    format_salaries()
    format_solved_finances()
    format_unsolved_finances()
    print(f'Wrote transfer-ready CSVs to: {OUT_DIR}')


if __name__ == '__main__':
    main()
