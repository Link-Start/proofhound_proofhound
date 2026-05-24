CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE SCHEMA "ph_core";
--> statement-breakpoint
CREATE SCHEMA "ph_assets";
--> statement-breakpoint
CREATE SCHEMA "ph_runs";
--> statement-breakpoint
CREATE SCHEMA "ph_releases";
--> statement-breakpoint
CREATE TABLE "ph_core"."api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_encrypted" text,
	"prefix" text NOT NULL,
	"ip_whitelist" jsonb,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "api_tokens_scope_check" CHECK ("ph_core"."api_tokens"."scope" IN ('project_api', 'global_mcp')),
	CONSTRAINT "api_tokens_scope_fields_check" CHECK ((
        ("ph_core"."api_tokens"."scope" = 'project_api' AND "ph_core"."api_tokens"."project_id" IS NOT NULL) OR
        ("ph_core"."api_tokens"."scope" = 'global_mcp'  AND "ph_core"."api_tokens"."project_id" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "ph_core"."projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'classification' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "projects_type_check" CHECK ("ph_core"."projects"."type" IN ('classification', 'generative', 'agent')),
	CONSTRAINT "projects_status_check" CHECK ("ph_core"."projects"."status" IN ('active', 'archived'))
);
--> statement-breakpoint
INSERT INTO "ph_core"."projects" (
	"id",
	"name",
	"description",
	"type",
	"status",
	"created_by"
)
VALUES (
	'00000000-0000-4000-8000-000000000001',
	'Local Project',
	'Self-hosted single-project data boundary',
	'classification',
	'active',
	'00000000-0000-4000-8000-000000000001'
)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
CREATE TABLE "ph_assets"."connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"direction" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb NOT NULL,
	"config_encrypted" jsonb,
	"webhook_path" text,
	"webhook_token_id" uuid,
	"ip_whitelist" jsonb,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"last_probed_at" timestamp with time zone,
	"last_probe_error" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "connectors_direction_check" CHECK ("ph_assets"."connectors"."direction" IN ('input', 'output')),
	CONSTRAINT "connectors_type_check" CHECK ("ph_assets"."connectors"."type" IN ('redis', 'kafka', 'webhook')),
	CONSTRAINT "connectors_health_status_check" CHECK ("ph_assets"."connectors"."health_status" IN ('healthy', 'degraded', 'unhealthy', 'unknown')),
	CONSTRAINT "connectors_type_webhook_check" CHECK ((
        ("ph_assets"."connectors"."type" = 'webhook'   AND "ph_assets"."connectors"."direction" = 'input'  AND "ph_assets"."connectors"."webhook_path" IS NOT NULL) OR
        ("ph_assets"."connectors"."type" = 'webhook'   AND "ph_assets"."connectors"."direction" = 'output' AND "ph_assets"."connectors"."webhook_path" IS NULL)     OR
        ("ph_assets"."connectors"."type" <> 'webhook'  AND "ph_assets"."connectors"."webhook_path" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "ph_assets"."dataset_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ph_assets"."datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"field_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"has_images" boolean DEFAULT false NOT NULL,
	"storage_prefix" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ph_assets"."model_context_windows" (
	"provider_model_id" text PRIMARY KEY NOT NULL,
	"context_window_tokens" integer NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_context_windows_context_window_positive_check" CHECK ("ph_assets"."model_context_windows"."context_window_tokens" > 0)
);
--> statement-breakpoint
CREATE TABLE "ph_assets"."models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider_type" text NOT NULL,
	"provider_model_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"context_window_tokens" integer,
	"rpm_limit" integer DEFAULT 60 NOT NULL,
	"tpm_limit" integer DEFAULT 100000 NOT NULL,
	"concurrency_limit" integer DEFAULT 20 NOT NULL,
	"input_token_price_per_million" numeric(12, 6) DEFAULT '0' NOT NULL,
	"output_token_price_per_million" numeric(12, 6) DEFAULT '0' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extra_body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_probed_at" timestamp with time zone,
	"last_probe_error" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "models_context_window_tokens_positive_check" CHECK ("ph_assets"."models"."context_window_tokens" IS NULL OR "ph_assets"."models"."context_window_tokens" > 0),
	CONSTRAINT "models_rpm_limit_valid_check" CHECK ("ph_assets"."models"."rpm_limit" = -1 OR "ph_assets"."models"."rpm_limit" > 0),
	CONSTRAINT "models_tpm_limit_valid_check" CHECK ("ph_assets"."models"."tpm_limit" = -1 OR "ph_assets"."models"."tpm_limit" > 0),
	CONSTRAINT "models_concurrency_limit_valid_check" CHECK ("ph_assets"."models"."concurrency_limit" >= 1 AND "ph_assets"."models"."concurrency_limit" <= 999),
	CONSTRAINT "models_input_token_price_nonnegative_check" CHECK ("ph_assets"."models"."input_token_price_per_million" >= 0),
	CONSTRAINT "models_output_token_price_nonnegative_check" CHECK ("ph_assets"."models"."output_token_price_per_million" >= 0),
	CONSTRAINT "models_extra_body_object_check" CHECK (jsonb_typeof("ph_assets"."models"."extra_body") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ph_assets"."prompt_version_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"label" text NOT NULL,
	"label_type" text DEFAULT 'custom' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_version_labels_type_check" CHECK ("ph_assets"."prompt_version_labels"."label_type" IN ('system', 'custom')),
	CONSTRAINT "prompt_version_labels_label_check" CHECK ("ph_assets"."prompt_version_labels"."label" ~ '^[A-Za-z0-9一-鿿][A-Za-z0-9一-鿿_.:-]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "ph_assets"."prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"body" text,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_schema" jsonb,
	"judgment_rules" jsonb,
	"prompt_language" text DEFAULT 'zh-CN' NOT NULL,
	"parent_version_id" uuid,
	"generated_by_optimization_id" uuid,
	"change_reason" text,
	"is_frozen" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_at" timestamp with time zone,
	CONSTRAINT "prompt_versions_prompt_version_unique" UNIQUE("prompt_id","version_number"),
	CONSTRAINT "prompt_versions_prompt_language_check" CHECK ("ph_assets"."prompt_versions"."prompt_language" IN ('zh-CN', 'en-US'))
);
--> statement-breakpoint
CREATE TABLE "ph_assets"."prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"current_online_version_id" uuid,
	"default_dataset_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ph_runs"."annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_result_id" uuid NOT NULL,
	"run_result_created_at" timestamp with time zone NOT NULL,
	"task_id" uuid,
	"is_correct" boolean,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"locked_by" uuid,
	"locked_at" timestamp with time zone,
	"lock_heartbeat_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ph_runs"."experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prompt_version_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"optimization_id" uuid,
	"round_index" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"run_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dbos_workflow_id" text,
	"control_state" text,
	"total_samples" integer DEFAULT 0 NOT NULL,
	"processed_samples" integer DEFAULT 0 NOT NULL,
	"failed_samples" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb,
	"failure_kind" text,
	"failure_reason" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "experiments_status_check" CHECK ("ph_runs"."experiments"."status" IN ('running', 'success', 'failed', 'stopped', 'cancelled')),
	CONSTRAINT "experiments_control_state_check" CHECK ("ph_runs"."experiments"."control_state" IN ('stop', 'resume', 'cancel') OR "ph_runs"."experiments"."control_state" IS NULL),
	CONSTRAINT "experiments_failure_kind_check" CHECK ("ph_runs"."experiments"."failure_kind" IN ('rate_limit', 'parse', 'timeout', 'internal') OR "ph_runs"."experiments"."failure_kind" IS NULL),
	CONSTRAINT "experiments_optimization_round_paired" CHECK (("ph_runs"."experiments"."optimization_id" IS NULL) = ("ph_runs"."experiments"."round_index" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ph_runs"."optimization_round_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"optimization_id" uuid NOT NULL,
	"round_index" integer NOT NULL,
	"step" text NOT NULL,
	"status" text NOT NULL,
	"error_class" text,
	"error_message" text,
	"run_result_id" uuid,
	"experiment_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"attempt" integer DEFAULT 0 NOT NULL,
	"dbos_workflow_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "optimization_round_steps_step_check" CHECK ("ph_runs"."optimization_round_steps"."step" IN ('error_analysis', 'generate_prompt', 'experiment')),
	CONSTRAINT "optimization_round_steps_status_check" CHECK ("ph_runs"."optimization_round_steps"."status" IN ('pending', 'running', 'success', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "ph_runs"."optimizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"optimization_hint" text,
	"strategy" text DEFAULT 'error_pattern_analysis' NOT NULL,
	"strategy_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"starting_mode" text NOT NULL,
	"source_experiment_id" uuid,
	"prompt_id" uuid,
	"base_version_id" uuid,
	"dataset_id" uuid NOT NULL,
	"experiment_model_id" uuid NOT NULL,
	"analysis_model_id" uuid NOT NULL,
	"prompt_language" text DEFAULT 'zh-CN' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"dbos_workflow_id" text,
	"control_state" text,
	"goals" jsonb NOT NULL,
	"field_whitelist" jsonb,
	"run_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_rounds" integer DEFAULT 10 NOT NULL,
	"current_round" integer DEFAULT 0 NOT NULL,
	"best_version_id" uuid,
	"best_metrics" jsonb,
	"summary" jsonb,
	"analysis_failure_reason" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "optimizations_status_check" CHECK ("ph_runs"."optimizations"."status" IN ('running', 'success', 'failed', 'stopped', 'cancelled')),
	CONSTRAINT "optimizations_starting_mode_check" CHECK ("ph_runs"."optimizations"."starting_mode" IN ('from_experiment', 'from_prompt_version', 'from_dataset_only')),
	CONSTRAINT "optimizations_control_state_check" CHECK ("ph_runs"."optimizations"."control_state" IN ('stop', 'resume', 'cancel') OR "ph_runs"."optimizations"."control_state" IS NULL),
	CONSTRAINT "optimizations_prompt_language_check" CHECK ("ph_runs"."optimizations"."prompt_language" IN ('zh-CN', 'en-US'))
);
--> statement-breakpoint
CREATE TABLE "ph_runs"."run_results" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_id" uuid NOT NULL,
	"release_variant_id" uuid,
	"prompt_version_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"sample_id" uuid,
	"external_id" text,
	"round_index" integer,
	"rendered_prompt" jsonb NOT NULL,
	"input_variables" jsonb,
	"raw_response" text,
	"parsed_output" jsonb,
	"decision_output" text,
	"expected_output" text,
	"is_correct" boolean,
	"judgment_status" text,
	"status" text NOT NULL,
	"error_class" text,
	"error_message" text,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_estimate" numeric(12, 6),
	"attempt" integer DEFAULT 1 NOT NULL,
	"dbos_workflow_id" text,
	"bullmq_job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_results_pkey" PRIMARY KEY("id","created_at"),
	CONSTRAINT "run_results_source_check" CHECK ("ph_runs"."run_results"."source" IN ('experiment', 'optimization_analysis', 'optimization_generate', 'release', 'canary', 'online')),
	CONSTRAINT "run_results_judgment_status_check" CHECK ("ph_runs"."run_results"."judgment_status" IN ('correct', 'incorrect', 'parse_error', 'judge_error') OR "ph_runs"."run_results"."judgment_status" IS NULL),
	CONSTRAINT "run_results_status_check" CHECK ("ph_runs"."run_results"."status" IN ('success', 'error', 'timeout', 'rate_limited'))
);
--> statement-breakpoint
CREATE TABLE "ph_releases"."release_line_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"release_line_id" uuid NOT NULL,
	"lane_type" text NOT NULL,
	"operation" text NOT NULL,
	"status" text NOT NULL,
	"terminal_reason" text,
	"source_event_id" uuid,
	"supersedes_event_id" uuid,
	"rollback_target_event_id" uuid,
	"legacy_source" text,
	"legacy_source_id" uuid,
	"release_variant_id" uuid,
	"prompt_id" uuid,
	"prompt_name" text NOT NULL,
	"prompt_version_id" uuid,
	"prompt_version_number" integer,
	"prompt_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt_version_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_id" uuid,
	"model_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_connector_id" uuid,
	"input_connector_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_connector_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"output_connector_snapshots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"traffic_mode" text,
	"traffic_ratio" numeric(5, 4),
	"run_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"variable_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_mapping" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filter_rules" jsonb,
	"record_mode" text DEFAULT 'all' NOT NULL,
	"external_id_field" text,
	"retention_days" integer,
	"source_experiment_id" uuid,
	"submit_reason" text DEFAULT '' NOT NULL,
	"metrics" jsonb,
	"total_received" integer DEFAULT 0 NOT NULL,
	"total_processed" integer DEFAULT 0 NOT NULL,
	"total_filtered" integer DEFAULT 0 NOT NULL,
	"total_correct" integer DEFAULT 0 NOT NULL,
	"total_errors" integer DEFAULT 0 NOT NULL,
	"control_state" text,
	"control_state_payload" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_line_events_lane_type_check" CHECK ("ph_releases"."release_line_events"."lane_type" IN ('production', 'canary')),
	CONSTRAINT "release_line_events_operation_check" CHECK ("ph_releases"."release_line_events"."operation" IN (
        'create_production',
        'create_production_from_experiment',
        'create_canary',
        'traffic_updated',
        'mode_updated',
        'config_changed',
        'stop_lane',
        'resume_lane',
        'cancel_canary',
        'promote_canary',
        'rollback',
        'force_stop',
        'archive_line'
      )),
	CONSTRAINT "release_line_events_status_check" CHECK ("ph_releases"."release_line_events"."status" IN ('running', 'stopped', 'completed', 'failed', 'cancelled', 'archived')),
	CONSTRAINT "release_line_events_terminal_reason_check" CHECK ("ph_releases"."release_line_events"."terminal_reason" IN ('replaced', 'rolled_back', 'force_stopped', 'promoted', 'cancelled', 'archived', 'error') OR "ph_releases"."release_line_events"."terminal_reason" IS NULL),
	CONSTRAINT "release_line_events_traffic_mode_check" CHECK ("ph_releases"."release_line_events"."traffic_mode" IN ('split', 'dual_run') OR "ph_releases"."release_line_events"."traffic_mode" IS NULL),
	CONSTRAINT "release_line_events_traffic_ratio_check" CHECK ("ph_releases"."release_line_events"."traffic_ratio" IS NULL OR ("ph_releases"."release_line_events"."traffic_ratio" >= 0 AND "ph_releases"."release_line_events"."traffic_ratio" <= 1)),
	CONSTRAINT "release_line_events_record_mode_check" CHECK ("ph_releases"."release_line_events"."record_mode" IN ('all', 'correct_only')),
	CONSTRAINT "release_line_events_rollback_target_required" CHECK ("ph_releases"."release_line_events"."operation" <> 'rollback' OR "ph_releases"."release_line_events"."rollback_target_event_id" IS NOT NULL),
	CONSTRAINT "release_line_events_promote_source_required" CHECK ("ph_releases"."release_line_events"."operation" <> 'promote_canary' OR "ph_releases"."release_line_events"."source_event_id" IS NOT NULL),
	CONSTRAINT "release_line_events_legacy_source_check" CHECK ("ph_releases"."release_line_events"."legacy_source" IN ('production_release_event', 'canary_release') OR "ph_releases"."release_line_events"."legacy_source" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "ph_releases"."release_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"prompt_id" uuid,
	"prompt_name" text NOT NULL,
	"prompt_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_connector_id" uuid,
	"input_connector_name" text,
	"input_connector_type" text,
	"input_connector_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'canary' NOT NULL,
	"current_production_event_id" uuid,
	"active_canary_event_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "release_lines_status_check" CHECK ("ph_releases"."release_lines"."status" IN ('canary', 'production', 'production_with_canary', 'stopped', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "ph_releases"."release_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"release_line_id" uuid NOT NULL,
	"variant_number" integer NOT NULL,
	"prompt_id" uuid,
	"prompt_name" text NOT NULL,
	"prompt_version_id" uuid NOT NULL,
	"prompt_version_number" integer,
	"prompt_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt_version_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_id" uuid NOT NULL,
	"model_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_variants_number_positive_check" CHECK ("ph_releases"."release_variants"."variant_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "ph_releases"."canary_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text,
	"description" text,
	"prompt_version_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"input_connector_id" uuid NOT NULL,
	"output_connector_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"control_state" text,
	"control_state_payload" jsonb,
	"traffic_ratio" numeric(5, 4) NOT NULL,
	"traffic_mode" text DEFAULT 'split' NOT NULL,
	"run_mode" text NOT NULL,
	"stop_conditions" jsonb,
	"record_mode" text DEFAULT 'all' NOT NULL,
	"filter_rules" jsonb,
	"variable_mapping" jsonb NOT NULL,
	"output_mapping" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_id_field" text NOT NULL,
	"annotation_schema" jsonb,
	"storage_categories" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"target_dataset_id" uuid,
	"run_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_received" integer DEFAULT 0 NOT NULL,
	"total_processed" integer DEFAULT 0 NOT NULL,
	"total_filtered" integer DEFAULT 0 NOT NULL,
	"total_correct" integer DEFAULT 0 NOT NULL,
	"total_errors" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "canary_releases_status_check" CHECK ("ph_releases"."canary_releases"."status" IN ('pending', 'running', 'stopped', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "canary_releases_control_state_check" CHECK ("ph_releases"."canary_releases"."control_state" IN ('stop', 'resume', 'cancel', 'extend') OR "ph_releases"."canary_releases"."control_state" IS NULL),
	CONSTRAINT "canary_releases_run_mode_check" CHECK ("ph_releases"."canary_releases"."run_mode" IN ('fixed_duration', 'manual')),
	CONSTRAINT "canary_releases_traffic_mode_check" CHECK ("ph_releases"."canary_releases"."traffic_mode" IN ('split', 'dual_run')),
	CONSTRAINT "canary_releases_record_mode_check" CHECK ("ph_releases"."canary_releases"."record_mode" IN ('all', 'correct_only')),
	CONSTRAINT "canary_releases_traffic_ratio_check" CHECK ("ph_releases"."canary_releases"."traffic_ratio" >= 0 AND "ph_releases"."canary_releases"."traffic_ratio" <= 1)
);
--> statement-breakpoint
CREATE TABLE "ph_releases"."production_release_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"prompt_version_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"input_connector_id" uuid,
	"output_connector_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"run_config" jsonb NOT NULL,
	"variable_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filter_rules" jsonb,
	"record_mode" text DEFAULT 'all' NOT NULL,
	"external_id_field" text,
	"retention_days" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"created_by" uuid NOT NULL,
	"submit_reason" text NOT NULL,
	"source_experiment_id" uuid,
	"source_canary_id" uuid,
	"source_metrics_snapshot" jsonb,
	"prompt_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt_version_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rollback_target_event_id" uuid,
	"control_state" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"stop_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_release_events_event_type_check" CHECK ("ph_releases"."production_release_events"."event_type" IN ('from_prompt', 'from_experiment', 'from_canary', 'config_change', 'rollback', 'force_stop')),
	CONSTRAINT "production_release_events_record_mode_check" CHECK ("ph_releases"."production_release_events"."record_mode" IN ('all', 'correct_only')),
	CONSTRAINT "production_release_events_status_check" CHECK ("ph_releases"."production_release_events"."status" IN ('running', 'success', 'failed', 'stopped')),
	CONSTRAINT "production_release_events_control_state_check" CHECK ("ph_releases"."production_release_events"."control_state" IN ('stop', 'resume', 'cancel') OR "ph_releases"."production_release_events"."control_state" IS NULL),
	CONSTRAINT "production_release_events_stop_reason_check" CHECK ("ph_releases"."production_release_events"."stop_reason" IN ('replaced', 'rolled_back', 'force_stopped', 'error') OR "ph_releases"."production_release_events"."stop_reason" IS NULL),
	CONSTRAINT "production_release_events_source_experiment_required" CHECK ("ph_releases"."production_release_events"."event_type" <> 'from_experiment' OR "ph_releases"."production_release_events"."source_experiment_id" IS NOT NULL),
	CONSTRAINT "production_release_events_source_canary_required" CHECK ("ph_releases"."production_release_events"."event_type" <> 'from_canary' OR "ph_releases"."production_release_events"."source_canary_id" IS NOT NULL),
	CONSTRAINT "production_release_events_rollback_target_required" CHECK ("ph_releases"."production_release_events"."event_type" <> 'rollback' OR "ph_releases"."production_release_events"."rollback_target_event_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ph_releases"."annotation_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"canary_id" uuid,
	"production_release_event_id" uuid,
	"release_line_event_id" uuid,
	"release_variant_id" uuid,
	"name" text NOT NULL,
	"annotation_schema" jsonb NOT NULL,
	"sampling_config" jsonb,
	"total_sampled" integer DEFAULT 0 NOT NULL,
	"total_annotated" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annotation_tasks_scope_check" CHECK ("ph_releases"."annotation_tasks"."scope" IN ('canary', 'online')),
	CONSTRAINT "annotation_tasks_status_check" CHECK ("ph_releases"."annotation_tasks"."status" IN ('active', 'completed', 'archived')),
	CONSTRAINT "annotation_tasks_scope_target_consistent" CHECK (("ph_releases"."annotation_tasks"."scope" = 'canary' AND "ph_releases"."annotation_tasks"."production_release_event_id" IS NULL AND ("ph_releases"."annotation_tasks"."release_variant_id" IS NOT NULL OR "ph_releases"."annotation_tasks"."release_line_event_id" IS NOT NULL OR "ph_releases"."annotation_tasks"."canary_id" IS NOT NULL))
        OR ("ph_releases"."annotation_tasks"."scope" = 'online' AND "ph_releases"."annotation_tasks"."canary_id" IS NULL AND ("ph_releases"."annotation_tasks"."release_variant_id" IS NOT NULL OR "ph_releases"."annotation_tasks"."release_line_event_id" IS NOT NULL OR "ph_releases"."annotation_tasks"."production_release_event_id" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "ph_core"."api_tokens" ADD CONSTRAINT "api_tokens_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_assets"."connectors" ADD CONSTRAINT "connectors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_assets"."connectors" ADD CONSTRAINT "connectors_webhook_token_id_api_tokens_id_fk" FOREIGN KEY ("webhook_token_id") REFERENCES "ph_core"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_samples" ADD CONSTRAINT "dataset_samples_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "ph_assets"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_assets"."datasets" ADD CONSTRAINT "datasets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_assets"."models" ADD CONSTRAINT "models_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_assets"."prompt_version_labels" ADD CONSTRAINT "prompt_version_labels_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "ph_assets"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_assets"."prompt_version_labels" ADD CONSTRAINT "prompt_version_labels_version_id_prompt_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "ph_assets"."prompt_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_assets"."prompt_versions" ADD CONSTRAINT "prompt_versions_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "ph_assets"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_assets"."prompts" ADD CONSTRAINT "prompts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_assets"."prompts" ADD CONSTRAINT "prompts_default_dataset_id_datasets_id_fk" FOREIGN KEY ("default_dataset_id") REFERENCES "ph_assets"."datasets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_runs"."annotations" ADD CONSTRAINT "annotations_task_id_annotation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "ph_releases"."annotation_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_runs"."experiments" ADD CONSTRAINT "experiments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_runs"."experiments" ADD CONSTRAINT "experiments_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "ph_assets"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_runs"."experiments" ADD CONSTRAINT "experiments_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "ph_assets"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_runs"."experiments" ADD CONSTRAINT "experiments_optimization_id_optimizations_id_fk" FOREIGN KEY ("optimization_id") REFERENCES "ph_runs"."optimizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_runs"."optimization_round_steps" ADD CONSTRAINT "optimization_round_steps_optimization_id_optimizations_id_fk" FOREIGN KEY ("optimization_id") REFERENCES "ph_runs"."optimizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_runs"."optimizations" ADD CONSTRAINT "optimizations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_runs"."optimizations" ADD CONSTRAINT "optimizations_source_experiment_id_experiments_id_fk" FOREIGN KEY ("source_experiment_id") REFERENCES "ph_runs"."experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_runs"."optimizations" ADD CONSTRAINT "optimizations_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "ph_assets"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_runs"."optimizations" ADD CONSTRAINT "optimizations_experiment_model_id_models_id_fk" FOREIGN KEY ("experiment_model_id") REFERENCES "ph_assets"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_runs"."optimizations" ADD CONSTRAINT "optimizations_analysis_model_id_models_id_fk" FOREIGN KEY ("analysis_model_id") REFERENCES "ph_assets"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" ADD CONSTRAINT "run_results_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_runs"."run_results" ADD CONSTRAINT "run_results_release_variant_id_release_variants_id_fk" FOREIGN KEY ("release_variant_id") REFERENCES "ph_releases"."release_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_line_events" ADD CONSTRAINT "release_line_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_line_events" ADD CONSTRAINT "release_line_events_release_line_id_release_lines_id_fk" FOREIGN KEY ("release_line_id") REFERENCES "ph_releases"."release_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_line_events" ADD CONSTRAINT "release_line_events_release_variant_id_release_variants_id_fk" FOREIGN KEY ("release_variant_id") REFERENCES "ph_releases"."release_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_line_events" ADD CONSTRAINT "release_line_events_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "ph_assets"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_line_events" ADD CONSTRAINT "release_line_events_input_connector_id_connectors_id_fk" FOREIGN KEY ("input_connector_id") REFERENCES "ph_assets"."connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_line_events" ADD CONSTRAINT "release_line_events_source_experiment_id_experiments_id_fk" FOREIGN KEY ("source_experiment_id") REFERENCES "ph_runs"."experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_lines" ADD CONSTRAINT "release_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_lines" ADD CONSTRAINT "release_lines_input_connector_id_connectors_id_fk" FOREIGN KEY ("input_connector_id") REFERENCES "ph_assets"."connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_variants" ADD CONSTRAINT "release_variants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_variants" ADD CONSTRAINT "release_variants_release_line_id_release_lines_id_fk" FOREIGN KEY ("release_line_id") REFERENCES "ph_releases"."release_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."release_variants" ADD CONSTRAINT "release_variants_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "ph_assets"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."canary_releases" ADD CONSTRAINT "canary_releases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."canary_releases" ADD CONSTRAINT "canary_releases_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "ph_assets"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."canary_releases" ADD CONSTRAINT "canary_releases_input_connector_id_connectors_id_fk" FOREIGN KEY ("input_connector_id") REFERENCES "ph_assets"."connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."canary_releases" ADD CONSTRAINT "canary_releases_target_dataset_id_datasets_id_fk" FOREIGN KEY ("target_dataset_id") REFERENCES "ph_assets"."datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."production_release_events" ADD CONSTRAINT "production_release_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."production_release_events" ADD CONSTRAINT "production_release_events_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "ph_assets"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."production_release_events" ADD CONSTRAINT "production_release_events_input_connector_id_connectors_id_fk" FOREIGN KEY ("input_connector_id") REFERENCES "ph_assets"."connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."production_release_events" ADD CONSTRAINT "production_release_events_source_experiment_id_experiments_id_fk" FOREIGN KEY ("source_experiment_id") REFERENCES "ph_runs"."experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."production_release_events" ADD CONSTRAINT "production_release_events_source_canary_id_canary_releases_id_fk" FOREIGN KEY ("source_canary_id") REFERENCES "ph_releases"."canary_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."production_release_events" ADD CONSTRAINT "production_release_events_rollback_target_event_id_production_release_events_id_fk" FOREIGN KEY ("rollback_target_event_id") REFERENCES "ph_releases"."production_release_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."annotation_tasks" ADD CONSTRAINT "annotation_tasks_canary_id_canary_releases_id_fk" FOREIGN KEY ("canary_id") REFERENCES "ph_releases"."canary_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."annotation_tasks" ADD CONSTRAINT "annotation_tasks_production_release_event_id_production_release_events_id_fk" FOREIGN KEY ("production_release_event_id") REFERENCES "ph_releases"."production_release_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."annotation_tasks" ADD CONSTRAINT "annotation_tasks_release_line_event_id_release_line_events_id_fk" FOREIGN KEY ("release_line_event_id") REFERENCES "ph_releases"."release_line_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_releases"."annotation_tasks" ADD CONSTRAINT "annotation_tasks_release_variant_id_release_variants_id_fk" FOREIGN KEY ("release_variant_id") REFERENCES "ph_releases"."release_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_api_tokens_project" ON "ph_core"."api_tokens" USING btree ("project_id") WHERE "ph_core"."api_tokens"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_api_tokens_active" ON "ph_core"."api_tokens" USING btree ("scope") WHERE "ph_core"."api_tokens"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_active_global_mcp_token" ON "ph_core"."api_tokens" USING btree ("scope") WHERE "ph_core"."api_tokens"."scope" = 'global_mcp' AND "ph_core"."api_tokens"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_projects_active" ON "ph_core"."projects" USING btree ("status") WHERE "ph_core"."projects"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_connectors_project_name_active" ON "ph_assets"."connectors" USING btree ("project_id","name") WHERE "ph_assets"."connectors"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_connectors_webhook_path_active" ON "ph_assets"."connectors" USING btree ("project_id","webhook_path") WHERE "ph_assets"."connectors"."webhook_path" IS NOT NULL AND "ph_assets"."connectors"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_connectors_project" ON "ph_assets"."connectors" USING btree ("project_id") WHERE "ph_assets"."connectors"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_dataset_samples_dataset" ON "ph_assets"."dataset_samples" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "idx_dataset_samples_ext" ON "ph_assets"."dataset_samples" USING btree ("dataset_id","external_id") WHERE "ph_assets"."dataset_samples"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_datasets_project_name_active" ON "ph_assets"."datasets" USING btree ("project_id","name") WHERE "ph_assets"."datasets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_datasets_project" ON "ph_assets"."datasets" USING btree ("project_id") WHERE "ph_assets"."datasets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_models_project_name_active" ON "ph_assets"."models" USING btree ("project_id","name") WHERE "ph_assets"."models"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_models_project" ON "ph_assets"."models" USING btree ("project_id") WHERE "ph_assets"."models"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_prompt_version_labels_prompt_label" ON "ph_assets"."prompt_version_labels" USING btree ("prompt_id","label");--> statement-breakpoint
CREATE INDEX "idx_prompt_version_labels_version" ON "ph_assets"."prompt_version_labels" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "idx_prompt_versions_prompt" ON "ph_assets"."prompt_versions" USING btree ("prompt_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_prompts_project_name_active" ON "ph_assets"."prompts" USING btree ("project_id","name") WHERE "ph_assets"."prompts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_prompts_project" ON "ph_assets"."prompts" USING btree ("project_id") WHERE "ph_assets"."prompts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_prompts_default_dataset" ON "ph_assets"."prompts" USING btree ("default_dataset_id") WHERE "ph_assets"."prompts"."default_dataset_id" IS NOT NULL AND "ph_assets"."prompts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_annotations_run_result_task" ON "ph_runs"."annotations" USING btree ("run_result_id","task_id");--> statement-breakpoint
CREATE INDEX "idx_annotations_run_result" ON "ph_runs"."annotations" USING btree ("run_result_id");--> statement-breakpoint
CREATE INDEX "idx_annotations_task" ON "ph_runs"."annotations" USING btree ("task_id") WHERE "ph_runs"."annotations"."task_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_annotations_lock_stale" ON "ph_runs"."annotations" USING btree ("task_id","lock_heartbeat_at") WHERE "ph_runs"."annotations"."locked_by" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_experiments_project_name_active" ON "ph_runs"."experiments" USING btree ("project_id","name") WHERE "ph_runs"."experiments"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_experiments_project_created" ON "ph_runs"."experiments" USING btree ("project_id","created_at") WHERE "ph_runs"."experiments"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_experiments_dbos" ON "ph_runs"."experiments" USING btree ("dbos_workflow_id") WHERE "ph_runs"."experiments"."dbos_workflow_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_experiments_status" ON "ph_runs"."experiments" USING btree ("project_id","status") WHERE "ph_runs"."experiments"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "experiments_optimization_round_uq" ON "ph_runs"."experiments" USING btree ("optimization_id","round_index") WHERE "ph_runs"."experiments"."optimization_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "optimization_round_steps_uq" ON "ph_runs"."optimization_round_steps" USING btree ("optimization_id","round_index","step");--> statement-breakpoint
CREATE INDEX "idx_optimization_round_steps_by_iter" ON "ph_runs"."optimization_round_steps" USING btree ("optimization_id","round_index");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_optimization_project_name_active" ON "ph_runs"."optimizations" USING btree ("project_id","name") WHERE "ph_runs"."optimizations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_optimization_project_created" ON "ph_runs"."optimizations" USING btree ("project_id","created_at") WHERE "ph_runs"."optimizations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_optimization_dbos" ON "ph_runs"."optimizations" USING btree ("dbos_workflow_id") WHERE "ph_runs"."optimizations"."dbos_workflow_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_optimization_running" ON "ph_runs"."optimizations" USING btree ("project_id") WHERE "ph_runs"."optimizations"."status" = 'running';--> statement-breakpoint
CREATE INDEX "idx_run_results_project_source_time" ON "ph_runs"."run_results" USING btree ("project_id","source","source_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_run_results_release_variant_time" ON "ph_runs"."run_results" USING btree ("project_id","release_variant_id","created_at") WHERE "ph_runs"."run_results"."release_variant_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_run_results_external_id" ON "ph_runs"."run_results" USING btree ("external_id") WHERE "ph_runs"."run_results"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_run_results_dbos" ON "ph_runs"."run_results" USING btree ("dbos_workflow_id") WHERE "ph_runs"."run_results"."dbos_workflow_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_run_results_bullmq_job" ON "ph_runs"."run_results" USING btree ("bullmq_job_id") WHERE "ph_runs"."run_results"."bullmq_job_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_run_results_prompt_version" ON "ph_runs"."run_results" USING btree ("prompt_version_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_run_results_id_lookup" ON "ph_runs"."run_results" USING btree ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_release_line_event_legacy_source" ON "ph_releases"."release_line_events" USING btree ("project_id","legacy_source","legacy_source_id") WHERE "ph_releases"."release_line_events"."legacy_source" IS NOT NULL AND "ph_releases"."release_line_events"."legacy_source_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_running_production_event_per_line" ON "ph_releases"."release_line_events" USING btree ("release_line_id") WHERE "ph_releases"."release_line_events"."lane_type" = 'production' AND "ph_releases"."release_line_events"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_active_canary_event_per_line" ON "ph_releases"."release_line_events" USING btree ("release_line_id") WHERE "ph_releases"."release_line_events"."lane_type" = 'canary' AND "ph_releases"."release_line_events"."status" IN ('running', 'stopped');--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_running_production_event_per_prompt" ON "ph_releases"."release_line_events" USING btree ("prompt_id") WHERE "ph_releases"."release_line_events"."lane_type" = 'production' AND "ph_releases"."release_line_events"."status" = 'running' AND "ph_releases"."release_line_events"."prompt_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_release_line_events_line_created" ON "ph_releases"."release_line_events" USING btree ("release_line_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_release_line_events_project_lane_status" ON "ph_releases"."release_line_events" USING btree ("project_id","lane_type","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_release_line_events_project_prompt" ON "ph_releases"."release_line_events" USING btree ("project_id","prompt_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_release_line_events_variant" ON "ph_releases"."release_line_events" USING btree ("release_variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_active_release_line_per_input_connector" ON "ph_releases"."release_lines" USING btree ("input_connector_id") WHERE "ph_releases"."release_lines"."status" <> 'archived' AND "ph_releases"."release_lines"."input_connector_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_release_lines_project_name" ON "ph_releases"."release_lines" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "idx_release_lines_project_status" ON "ph_releases"."release_lines" USING btree ("project_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "idx_release_lines_project_prompt" ON "ph_releases"."release_lines" USING btree ("project_id","prompt_id");--> statement-breakpoint
CREATE INDEX "idx_release_lines_project_input" ON "ph_releases"."release_lines" USING btree ("project_id","input_connector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_release_variants_line_number" ON "ph_releases"."release_variants" USING btree ("release_line_id","variant_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_release_variants_line_prompt_model" ON "ph_releases"."release_variants" USING btree ("release_line_id","prompt_version_id","model_id");--> statement-breakpoint
CREATE INDEX "idx_release_variants_project_line" ON "ph_releases"."release_variants" USING btree ("project_id","release_line_id");--> statement-breakpoint
CREATE INDEX "idx_release_variants_project_prompt_model" ON "ph_releases"."release_variants" USING btree ("project_id","prompt_version_id","model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_running_canary_per_input_connector" ON "ph_releases"."canary_releases" USING btree ("input_connector_id") WHERE "ph_releases"."canary_releases"."status" = 'running' AND "ph_releases"."canary_releases"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_canary_project_created" ON "ph_releases"."canary_releases" USING btree ("project_id","created_at") WHERE "ph_releases"."canary_releases"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_canary_status" ON "ph_releases"."canary_releases" USING btree ("project_id","status") WHERE "ph_releases"."canary_releases"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_canary_prompt_version" ON "ph_releases"."canary_releases" USING btree ("prompt_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_running_release_per_prompt" ON "ph_releases"."production_release_events" USING btree ("prompt_id") WHERE "ph_releases"."production_release_events"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_running_release_per_input_connector" ON "ph_releases"."production_release_events" USING btree ("input_connector_id") WHERE "ph_releases"."production_release_events"."status" = 'running' AND "ph_releases"."production_release_events"."input_connector_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_release_events_status_created" ON "ph_releases"."production_release_events" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_release_events_prompt_created" ON "ph_releases"."production_release_events" USING btree ("project_id","prompt_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_annotation_tasks_release_line_event" ON "ph_releases"."annotation_tasks" USING btree ("release_line_event_id");--> statement-breakpoint
CREATE INDEX "idx_annotation_tasks_release_variant" ON "ph_releases"."annotation_tasks" USING btree ("release_variant_id");
