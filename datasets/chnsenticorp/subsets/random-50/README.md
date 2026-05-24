# ChnSentiCorp Random 50

This is a 50-row uniform random subset sampled without replacement from `../../chnsenticorp.jsonl`.

## Files

ProofHound V1 currently accepts CSV, TSV, JSONL, and JSON array uploads. This directory provides the same 50 samples in every current uploadable format:

| File | Format | SHA-256 |
| --- | --- | --- |
| `chnsenticorp-random-50.csv` | CSV | `06d3cbaa284a3b04569e8e288268558929914214773a40f241bfb2aefed5e520` |
| `chnsenticorp-random-50.tsv` | TSV | `bcf45ff4efa6ccb1471e57a1b5d557bf8d3b736dd9fb464662b37930e49248a7` |
| `chnsenticorp-random-50.jsonl` | JSONL | `351df78eb6056f02291268bda768523bfbb2455fbfb01f4b360364f252518e10` |
| `chnsenticorp-random-50.json` | JSON array | `c43acbc67e7577696bc282107fded8d7edc22a1f0db47131ae9eb3c4dd7355aa` |
| `manifest.json` | Metadata | Sampling metadata, selected source line numbers, checksums, and recommended field mapping. |

## Upload Mapping

Use the same mapping as the full dataset:

| Field | Role | Notes |
| --- | --- | --- |
| `text` | text | Prompt variable. Suggested template variable: `{{text}}`. |
| `expected_output` | expected_output | Judgment target: `negative` or `positive`. |
| `sample_id` | metadata | Stable generated sample id from the full dataset. |
| `label` | metadata | Original numeric label: `0=negative`, `1=positive`. |
| `label_name` | metadata | Original label name. |
| `sentiment_zh` | metadata | Chinese display label: `负面` or `正面`. |
| `split` | metadata | Original split: `train`, `validation`, or `test`. |
| `source_dataset` | metadata | Upstream dataset id. |

## Sampling

- Method: uniform without replacement
- Source rows: 12,000
- Sample rows: 50
- Seed: 424385828

## Counts

| Group | Count |
| --- | ---: |
| split:test | 9 |
| split:train | 39 |
| split:validation | 2 |
| label:negative | 24 |
| label:positive | 26 |
