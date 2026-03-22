---
name: fabric-readonly
description: Browse and query Azure Fabric data. List workspaces, tables, schemas, run read-only SQL/KQL queries, check pipeline runs, trace data lineage. NEVER creates, modifies, or deletes anything.
---

# Azure Fabric (Read-Only)

## Available tools

- `fabric_list_workspaces` — list all accessible workspaces
- `fabric_list_items` — list items in a workspace (type: Lakehouse, Warehouse, Notebook, Pipeline, Report, SemanticModel, etc.)
- `fabric_get_item` — get details of a specific item including connection info
- `fabric_list_tables` — list tables in a lakehouse
- `fabric_get_table_schema` — get column names, types, and nullability for a table
- `fabric_query_sql` — execute a read-only SELECT query (INSERT/UPDATE/DELETE/etc. are rejected)
- `fabric_query_kql` — execute a KQL query against an Eventhouse
- `fabric_list_job_instances` — list pipeline/notebook run history
- `fabric_get_job_instance` — get details of a specific job run
- `fabric_list_onelake_files` — browse files and directories in OneLake
- `fabric_list_reports` — list Power BI reports
- `fabric_get_dataset_refresh_history` — check semantic model refresh history
- `fabric_get_item_lineage` — trace upstream/downstream data dependencies

## CRITICAL: Read-Only Only

These tools can ONLY read data. You cannot create, modify, or delete anything in Fabric.
If the user asks you to create a pipeline, modify a table, delete a lakehouse, trigger a refresh, or perform any write operation, explain that you only have read-only access and suggest they use the Fabric portal (https://app.fabric.microsoft.com) directly.

## Common workflows

### Explore a workspace
1. `fabric_list_workspaces` to find workspaces
2. `fabric_list_items` with the workspace ID to see all contents
3. `fabric_list_items` with `type: "Lakehouse"` to see just lakehouses

### Understand a table's structure
1. `fabric_list_tables` for a lakehouse to see available tables
2. `fabric_get_table_schema` with the SQL endpoint to see columns and types

### Query data
1. Get the SQL endpoint from `fabric_get_item` on the lakehouse
2. `fabric_get_table_schema` to understand columns first
3. `fabric_query_sql` with a SELECT statement (TOP 1000 auto-added if no limit)

### Check pipeline status
1. `fabric_list_items` with `type: "Pipeline"` to find pipelines
2. `fabric_list_job_instances` to see recent runs and their status
3. `fabric_get_job_instance` for details on a specific run (including failure reasons)

### Browse OneLake files
1. `fabric_list_onelake_files` with path "Files" to see the Files section
2. `fabric_list_onelake_files` with path "Tables" to see the Tables section
3. Navigate deeper by adding subdirectories to the path

### Check Power BI refreshes
1. `fabric_list_items` with `type: "SemanticModel"` to find datasets
2. `fabric_get_dataset_refresh_history` to see refresh status and timing
