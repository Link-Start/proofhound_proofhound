# 图片类型数据集上传样例

本目录基于开发 seed 里的 `images-mini` 图片数据集构建，样本来自 `packages/db/src/fixtures/dev/experiments.ts` 中的 `RECEIPT_CLASSIFICATION_SAMPLES`。它用于验证「图片 + 文本变量 + 期望输出」数据集的上传、字段映射与实验闭环。

## 当前可上传格式

ProofHound V1 上传页当前真实接通的解析格式是 CSV、TSV、JSONL、JSON 数组、ZIP。本目录提供六组图片数据集样例：前三组使用外部图片 URL，后三组使用 ZIP 同包本地图片。

- `images-mini.*`：和当前 dev seed 中 `images-mini` 等价的单图片字段样例。
- `images-single-field-array.*`：单字段多图片样例，`image_urls` 字段是图片 URL 数组。
- `images-multi-field.*`：多字段多图片样例，`front_image_url` / `back_image_url` 分别是一张图片。
- `images-zip-single-image.zip`：ZIP 单图片字段样例，CSV 引用同包图片路径。
- `images-zip-single-field-array.zip`：ZIP 单字段多图片样例，JSONL 数组引用同包图片路径。
- `images-zip-multi-field.zip`：ZIP 多字段多图片样例，CSV 多列引用同包图片路径。

### Seed 等价样例

| 文件                | 上传格式  | SHA-256                                                            |
| ------------------- | --------- | ------------------------------------------------------------------ |
| `images-mini.csv`   | CSV       | `883b428b70715c2207150adb9f7370ed69c6a2683855d78f7b34749fee08b729` |
| `images-mini.tsv`   | TSV       | `55e691c9f18ba080615ecbadc7635e419f67f377af0f80fa8406bc7c2b19f70d` |
| `images-mini.jsonl` | JSONL     | `d1c726c66d66edecf8c4f67abed0903372b00f22a6233f5276ef2086536ee1ed` |
| `images-mini.json`  | JSON 数组 | `eabdb9a0f3111bdac6598a1564a4a740c392f88b1d8ec1724cea5d64cb0c7496` |
| `manifest.json`     | 元数据    | 记录样本来源、推荐字段映射、文件校验信息。                         |

### 单字段多图片样例

| 文件                              | 上传格式  | SHA-256                                                            |
| --------------------------------- | --------- | ------------------------------------------------------------------ |
| `images-single-field-array.csv`   | CSV       | `739e63638c1203c2d7de1185dba535de9d695428f5fa8acd54db1ebf04e30e74` |
| `images-single-field-array.tsv`   | TSV       | `3c2b2f22ca45022e33ae6c25378bcc620e97c8ebc0904a5033326658f1fa4707` |
| `images-single-field-array.jsonl` | JSONL     | `d41efc8c42bfbc2accf236e613b07ce4bc89240ca4b3cbf962eb0d30c53c91f4` |
| `images-single-field-array.json`  | JSON 数组 | `c68a6d238f305da7a89a0b4f46722eac382bd00a7aa6c2802c3af51f343c301a` |

CSV / TSV 中的 `image_urls` 单元格是完整 JSON 数组字符串。不要用逗号、分号、竖线拆 URL；这些字符可能出现在 URL path / query 中。

### 多字段多图片样例

| 文件                       | 上传格式  | SHA-256                                                            |
| -------------------------- | --------- | ------------------------------------------------------------------ |
| `images-multi-field.csv`   | CSV       | `2be278571d8a9deb6b6574b630a7a0e0a5a0aebb0be261b21626cba203822c26` |
| `images-multi-field.tsv`   | TSV       | `37aca1637a4ebdd22ebf8db9203cbf2b7423ba1a8a1fd9cecb4a1815e0cbf100` |
| `images-multi-field.jsonl` | JSONL     | `a5f7039bdd699f6958cbaca27b2b5ab67584485118eef799f0ecd3a3e601ac12` |
| `images-multi-field.json`  | JSON 数组 | `e7f6c46e47b06702afe8b9c4e6a894b0d9bdb9e665603c3f4e3cbb44df09e16a` |

### ZIP 本地图片样例

| 文件                                | 上传格式 | SHA-256                                                            |
| ----------------------------------- | -------- | ------------------------------------------------------------------ |
| `images-zip-single-image.zip`       | ZIP      | `87912861a9380bd6056c573d6baed46fd123d298b0ca381f2babb9a429a19208` |
| `images-zip-single-field-array.zip` | ZIP      | `e85a4c34a04af62856daa6d127eb196e7d3089ee7352cc574aaf2db144674b17` |
| `images-zip-multi-field.zip`        | ZIP      | `d227cce643e4f4e5f967fe9e538ffcfde6fc2150374ad38fa3b8dc0cca041add` |

每个 ZIP 内都有一个 `manifest.json`，通过 `file` 字段指向包内数据文件。数据文件中的图片字段写相对路径，例如 `images/front.png`；上传页解析 ZIP 时会把这些图片转换为 `data:image/...;base64,...` 后再提交。

Excel 在产品 SPEC 中属于同一上传语义的后续扩展，但当前上传页还没有接通真实解析流程，所以这里不提供 `.xlsx` 示例。

## 推荐字段映射

上传后在字段映射向导中建议这样选择：

| 字段              | 上传页角色 | 入库后的语义          | 说明                                                              |
| ----------------- | ---------- | --------------------- | ----------------------------------------------------------------- |
| `sample_id`       | ID         | metadata + externalId | 样本稳定标识，选择 ID 后会作为样本 externalId。                   |
| `image_url`       | 图片       | image_url             | 图片输入变量。因为值是 `https://` URL，后端会推断为 `image_url`。 |
| `ocr_text`        | 文本变量   | text                  | 可在提示词模板中使用 `{{ocr_text}}`。                             |
| `expected_output` | 期望输出   | expected_output       | 分类标签：`receipt` / `coupon` / `invoice`。                      |
| `source`          | 元信息     | metadata              | 样本来源，仅用于展示与过滤，不进入提示词。                        |

单字段多图片样例额外使用：

| 字段         | 上传页角色 | 入库后的语义      | 说明                                                                             |
| ------------ | ---------- | ----------------- | -------------------------------------------------------------------------------- |
| `image_urls` | 图片       | image_url + array | 图片 URL 数组。JSONL / JSON 数组直接写数组；CSV / TSV 单元格写 JSON 数组字符串。 |

多字段多图片样例额外使用：

| 字段              | 上传页角色 | 入库后的语义 | 说明         |
| ----------------- | ---------- | ------------ | ------------ |
| `front_image_url` | 图片       | image_url    | 第一张图片。 |
| `back_image_url`  | 图片       | image_url    | 第二张图片。 |

ZIP 样例额外使用：

| 字段               | 上传页角色 | 入库后的语义         | 说明                                                     |
| ------------------ | ---------- | -------------------- | -------------------------------------------------------- |
| `image_path`       | 图片       | image_base64         | ZIP 内本地图片路径，上传解析后会变成 data URL。          |
| `image_paths`      | 图片       | image_base64 + array | ZIP 内本地图片路径数组，上传解析后会变成 data URL 数组。 |
| `front_image_path` | 图片       | image_base64         | ZIP 多字段样例的第一张本地图片路径。                     |
| `back_image_path`  | 图片       | image_base64         | ZIP 多字段样例的第二张本地图片路径。                     |

## 图片字段说明

- 图片字段在上传页统一选择「图片」角色。
- 如果字段值是 `http://` 或 `https://`，后端会把字段角色推断为 `image_url`。
- 如果字段值是 `data:image/...;base64,...`，后端会把字段角色推断为 `image_base64`。
- 如果字段值是数组，后端会从数组中第一张非空图片推断字段角色；实验渲染时会把数组展开为多张图片引用。
- 如果上传 ZIP，样本里的同包图片相对路径会先在前端转成 data URL，因此入库后通常推断为 `image_base64`。
- 其他字符串仍会按图片字段保存为 `image`，但实际推理是否可用取决于后续渲染和模型侧输入要求。
- 远端图片 URL 不会在 LLM 层主动下载或改写；资源的可访问性由数据集来源负责保证。

## 样本分布

| 类别      | 样本数 |
| --------- | -----: |
| `receipt` |      1 |
| `coupon`  |      1 |
| `invoice` |      1 |

## 上传验证建议

1. 进入项目的数据集上传页。
2. 任选本目录中的任一 `.csv`、`.tsv`、`.jsonl`、`.json` 或 `.zip` 样例。
3. 确认预览中有样本与字段；ZIP 样例的图片路径应已显示为 `data:image/...`。
4. 按「推荐字段映射」设置角色后导入。
5. 导入后数据集应显示文本与图片两个模态，类别分布应包含 3 个类别。
