# ChnSentiCorp

Source: [seamew/ChnSentiCorp](https://huggingface.co/datasets/seamew/ChnSentiCorp/tree/main)

This directory contains a ProofHound-ready JSONL export of the ChnSentiCorp Chinese sentiment classification dataset.

## Files

- `chnsenticorp.jsonl` - upload this file in the ProofHound dataset upload page.
- `manifest.json` - source metadata, row counts, checksum, and recommended field mapping.

## Upload Mapping

When the ProofHound upload wizard asks for field roles, use:

| Field | Role | Notes |
| --- | --- | --- |
| `text` | text | Prompt variable. Suggested template variable: `{{text}}`. |
| `expected_output` | expected_output | Judgment target: `negative` or `positive`. |
| `sample_id` | metadata | Stable generated sample id. |
| `label` | metadata | Original numeric label: `0=negative`, `1=positive`. |
| `label_name` | metadata | Original label name. |
| `sentiment_zh` | metadata | Chinese display label: `负面` or `正面`. |
| `split` | metadata | Original split: `train`, `validation`, or `test`. |
| `source_dataset` | metadata | Upstream dataset id. |

## Counts

| Split | Samples | Negative | Positive |
| --- | ---: | ---: | ---: |
| train | 9,600 | 4,801 | 4,799 |
| validation | 1,200 | 607 | 593 |
| test | 1,200 | 592 | 608 |
| total | 12,000 | 6,000 | 6,000 |

`chnsenticorp.jsonl` SHA-256:

```text
76829cab0b9cd70c184ba66ce64eff9abfd98c13080ebe76454f655f67510d27
```
