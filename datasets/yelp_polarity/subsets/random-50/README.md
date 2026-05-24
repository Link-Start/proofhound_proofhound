# Yelp Polarity Random 50

This is a 50-row uniform random subset sampled without replacement from `../../yelp_polarity.jsonl`.

## Files

ProofHound V1 currently accepts CSV, TSV, JSONL, and JSON array uploads. This directory provides the same 50 samples in every current uploadable format:

| File | Format | SHA-256 |
| --- | --- | --- |
| `yelp-polarity-random-50.csv` | CSV | `e76c8b17569663e3861a2dfa753ebcce2a364890bce172f82efcfcb250aa36e1` |
| `yelp-polarity-random-50.tsv` | TSV | `31bf6709d2a36ac7c788303f0253170c11e4e31eee4f668f4aa2f6906066ad01` |
| `yelp-polarity-random-50.jsonl` | JSONL | `9b5d545de6814738d89d50a050e3979eb26421c8c755a89a94c7934203ff470f` |
| `yelp-polarity-random-50.json` | JSON array | `33a4812aa7cff9cbdd10aeea932aaa3d14da07b0ce4e81dc3579588d777ffb6d` |
| `manifest.json` | Metadata | Sampling metadata, selected source line numbers, checksums, and recommended field mapping. |

## Upload Mapping

Use the same mapping as the full dataset:

| Field | Role | Notes |
| --- | --- | --- |
| `text` | text | Prompt variable. Suggested template variable: `{{text}}`. |
| `expected_output` | expected_output | Judgment target: `negative` or `positive`. |
| `sample_id` | metadata | Stable generated sample id from the full dataset. |
| `label` | metadata | HF numeric label: `0=negative`, `1=positive`. |
| `label_name` | metadata | Label name. |
| `sentiment_zh` | metadata | Chinese display label: `负面` or `正面`. |
| `original_class_index` | metadata | Original CSV class index: `1=negative`, `2=positive`. |
| `split` | metadata | Original split: `train` or `test`. |
| `source_dataset` | metadata | Upstream dataset id. |

## Sampling

- Method: uniform without replacement
- Source rows: 598,000
- Sample rows: 50
- Seed: 20260521

## Counts

| Group | Count |
| --- | ---: |
| split:test | 2 |
| split:train | 48 |
| label:negative | 28 |
| label:positive | 22 |
