import { SUPPORTED_MODEL_PROVIDER_TYPES, type SupportedModelProviderType } from '@proofhound/shared';

const PROVIDER_TYPE_LABELS: Record<SupportedModelProviderType, string> = {
  openai: 'OpenAI',
  'azure-openai': 'Azure OpenAI',
  anthropic: 'Claude / Anthropic',
  deepseek: 'DeepSeek',
  kimi: 'KIMI / Moonshot',
  minimax: 'MiniMax',
  qwen: 'Qwen / DashScope',
  ernie: 'ERNIE / Qianfan',
};

export interface ProviderTypeOption {
  value: string;
  label: string;
}

export function getProviderTypeLabel(providerType: string): string {
  return (PROVIDER_TYPE_LABELS as Record<string, string>)[providerType] ?? providerType;
}

// 如果当前值是历史遗留数据（如 'azure' 别名 / 大小写差异 / 已退场的 adapter），
// 把它作为额外选项追加在最前，避免编辑现有模型时下拉显示空。
export function buildProviderTypeOptions(currentValue?: string): ProviderTypeOption[] {
  const baseOptions: ProviderTypeOption[] = SUPPORTED_MODEL_PROVIDER_TYPES.map((value) => ({
    value,
    label: PROVIDER_TYPE_LABELS[value],
  }));

  const normalized = currentValue?.trim() ?? '';
  if (normalized && !baseOptions.some((option) => option.value === normalized)) {
    baseOptions.unshift({ value: normalized, label: getProviderTypeLabel(normalized) });
  }
  return baseOptions;
}
