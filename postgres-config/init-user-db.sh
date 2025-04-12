#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Create application user with proper permissions
    CREATE USER $POSTGRES_USER WITH PASSWORD '$POSTGRES_PASSWORD';
    ALTER USER $POSTGRES_USER WITH SUPERUSER;
    
    -- Create database and grant privileges
    CREATE DATABASE $POSTGRES_DB;
    GRANT ALL PRIVILEGES ON DATABASE $POSTGRES_DB TO $POSTGRES_USER;
    
    -- Enable extensions
    CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
    
    -- Set up connection limits
    ALTER SYSTEM SET max_connections = '100';
    ALTER SYSTEM SET shared_buffers = '256MB';
    ALTER SYSTEM SET effective_cache_size = '768MB';
    ALTER SYSTEM SET work_mem = '16MB';
    ALTER SYSTEM SET maintenance_work_mem = '64MB';
    
    -- Configure autovacuum
    ALTER SYSTEM SET autovacuum = 'on';
    ALTER SYSTEM SET autovacuum_max_workers = '3';
    ALTER SYSTEM SET autovacuum_naptime = '1min';
    ALTER SYSTEM SET autovacuum_vacuum_threshold = '50';
    ALTER SYSTEM SET autovacuum_analyze_threshold = '50';
    
    -- Configure checkpoint behavior
    ALTER SYSTEM SET checkpoint_timeout = '15min';
    ALTER SYSTEM SET checkpoint_completion_target = '0.9';
    ALTER SYSTEM SET max_wal_size = '1GB';
    ALTER SYSTEM SET min_wal_size = '80MB';
    
    -- Configure logging
    ALTER SYSTEM SET log_min_duration_statement = '1000';
    ALTER SYSTEM SET log_checkpoints = 'on';
    ALTER SYSTEM SET log_connections = 'on';
    ALTER SYSTEM SET log_disconnections = 'on';
    
    -- Reload configuration
    SELECT pg_reload_conf();
EOSQL

echo "PostgreSQL initialization completed successfully"
