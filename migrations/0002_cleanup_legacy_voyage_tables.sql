PRAGMA foreign_keys=OFF;

-- Legacy cargo/manifest model replaced by tote-based workflow.
DROP TABLE IF EXISTS voyage_manifest_lines;
DROP TABLE IF EXISTS cargo_types;

-- Redundant vessel config lists replaced by ship assignment/shipyard flow.
DROP TABLE IF EXISTS config_vessel_callsigns;
DROP TABLE IF EXISTS config_vessel_classes;
DROP TABLE IF EXISTS config_vessel_names;

PRAGMA foreign_keys=ON;
