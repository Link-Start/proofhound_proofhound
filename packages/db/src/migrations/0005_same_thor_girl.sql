CREATE TABLE "ph_assets"."dataset_import_samples" (
	"import_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"data" jsonb NOT NULL,
	"external_id" text,
	CONSTRAINT "dataset_import_samples_import_id_row_index_pk" PRIMARY KEY("import_id","row_index")
);
--> statement-breakpoint
CREATE TABLE "ph_assets"."dataset_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"dataset_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"field_mappings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_name" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"content_type" text,
	"source_format" text NOT NULL,
	"declared_total_rows" integer,
	"received_rows" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'importing' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dataset_imports_source_format_check" CHECK ("ph_assets"."dataset_imports"."source_format" IN ('jsonl', 'csv', 'tsv')),
	CONSTRAINT "dataset_imports_status_check" CHECK ("ph_assets"."dataset_imports"."status" IN ('importing', 'ready'))
);
--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_import_samples" ADD CONSTRAINT "dataset_import_samples_import_id_dataset_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "ph_assets"."dataset_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD CONSTRAINT "dataset_imports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "ph_core"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD CONSTRAINT "dataset_imports_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "ph_assets"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dataset_imports_project_status" ON "ph_assets"."dataset_imports" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "idx_dataset_imports_stale" ON "ph_assets"."dataset_imports" USING btree ("status","updated_at") WHERE "ph_assets"."dataset_imports"."status" = 'importing';