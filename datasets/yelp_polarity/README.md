# Yelp Polarity

Source: [fancyzhx/yelp_polarity](https://huggingface.co/datasets/fancyzhx/yelp_polarity) and the original CSV archive at `https://s3.amazonaws.com/fast-ai-nlp/yelp_review_polarity_csv.tgz`.

This directory contains a ProofHound-ready JSONL export of the Yelp Review Polarity English sentiment classification dataset.

## Files

- `yelp_polarity.jsonl` - upload this file in the ProofHound dataset upload page.
- `manifest.json` - source metadata, row counts, checksum, and recommended field mapping.
- `subsets/random-50/` - 50-row random subset in CSV, TSV, JSONL, and JSON array formats.

## Upload Mapping

When the ProofHound upload wizard asks for field roles, use:

| Field | Role | Notes |
| --- | --- | --- |
| `text` | text | Prompt variable. Suggested template variable: `{{text}}`. |
| `expected_output` | expected_output | Judgment target: `negative` or `positive`. |
| `sample_id` | metadata | Stable generated sample id. |
| `label` | metadata | HF numeric label: `0=negative`, `1=positive`. |
| `label_name` | metadata | Label name. |
| `sentiment_zh` | metadata | Chinese display label: `负面` or `正面`. |
| `original_class_index` | metadata | Original CSV class index: `1=negative`, `2=positive`. |
| `split` | metadata | Original split: `train` or `test`. |
| `source_dataset` | metadata | Upstream dataset id. |

## Counts

| Split | Samples | Negative | Positive |
| --- | ---: | ---: | ---: |
| train | 560,000 | 280,000 | 280,000 |
| test | 38,000 | 19,000 | 19,000 |
| total | 598,000 | 299,000 | 299,000 |

`yelp_polarity.jsonl` SHA-256:

```text
3442bb1c5a194359d1ae365bbf12fba2e67231b3c05ae102a3520fd374eb7401
```
