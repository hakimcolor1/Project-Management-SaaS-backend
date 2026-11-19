-- Runs once, when the Docker volume is first initialised.
-- A separate database keeps automated tests away from development data.
CREATE DATABASE teamflow_test OWNER teamflow;
