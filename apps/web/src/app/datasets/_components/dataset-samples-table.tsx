'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Edit3, Trash2 } from 'lucide-react';

import { ResourcePaginationFooter } from '@/components/ui/resource-pagination-footer';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  type TableColumn,
} from '@/components/ui/table';
import { TableActionIconButton } from '@/components/ui/table-action';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

import type { DatasetField, DatasetSample } from './dataset-types';
import { getImageReferences, getPrimaryImageReference } from './dataset-detail-helpers';
import { ImageCell, ImagePreviewDialog, SelectionBox } from './dataset-ui';
import { getDisplayValue } from './dataset-upload-parser';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

function fieldColumnKey(field: DatasetField): string {
  return `field:${field.name}`;
}

function buildSampleTableColumns(fields: DatasetField[]): TableColumn[] {
  const fieldCols: TableColumn[] = fields.map((field) => {
    const width: TableColumn['width'] = field.role === 'id' ? 'compact' : field.role === 'image' ? 'normal' : 'wide';
    return { key: fieldColumnKey(field), width };
  });
  return [
    { key: 'select', width: 'narrow', sticky: 'left' },
    ...fieldCols,
    { key: 'actions', width: 'compact', sticky: 'right' },
  ];
}

export interface DatasetSamplesTableProps {
  data: DatasetSample[];
  fields: DatasetField[];
  selectedSampleId: string;
  selectedIds: string[];
  headState: 'off' | 'some' | 'all';
  pageIndex: number;
  onPageIndexChange: (index: number) => void;
  onSelectSample: (sampleId: string) => void;
  onToggleSelected: (sampleId: string) => void;
  onToggleAll: () => void;
  onDeleteSample: (sampleId: string) => void;
  renderFieldHeaderTrailing?: (field: DatasetField) => ReactNode;
}

export function DatasetSamplesTable({
  data,
  fields,
  selectedSampleId,
  selectedIds,
  headState,
  pageIndex,
  onPageIndexChange,
  onSelectSample,
  onToggleSelected,
  onToggleAll,
  onDeleteSample,
  renderFieldHeaderTrailing,
}: DatasetSamplesTableProps) {
  const { t } = useI18n();
  const [pageSize, setPageSize] = useState<number>(10);
  const [preview, setPreview] = useState<{ field: string; value: string } | null>(null);

  const columns = useMemo(() => buildSampleTableColumns(fields), [fields]);

  const pageCount = Math.max(1, Math.ceil(data.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedSamples = useMemo(
    () => data.slice(safePageIndex * pageSize, (safePageIndex + 1) * pageSize),
    [data, safePageIndex, pageSize],
  );

  return (
    <div data-testid="dataset-samples-table">
      <Table columns={columns} className="rounded-none border-0">
        <TableHeader>
          <TableRow>
            <TableHead column="select">
              <SelectionBox
                checked={headState === 'all'}
                indeterminate={headState === 'some'}
                ariaLabel={t('datasets.detail.selectAllAria')}
                onClick={onToggleAll}
              />
            </TableHead>
            {fields.map((field) => (
              <TableHead key={fieldColumnKey(field)} column={fieldColumnKey(field)}>
                <div className="flex flex-nowrap items-center gap-2">
                  <span
                    className="whitespace-nowrap font-mono text-[12px] font-semibold text-foreground"
                    title={field.name}
                  >
                    {field.name}
                  </span>
                  {renderFieldHeaderTrailing ? renderFieldHeaderTrailing(field) : null}
                </div>
              </TableHead>
            ))}
            <TableHead column="actions" className="text-right">
              {t('common.actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pagedSamples.length === 0 ? (
            <TableEmpty />
          ) : (
            pagedSamples.map((sample) => {
              const selected = selectedIds.includes(sample.id);
              const active = sample.id === selectedSampleId;
              return (
                <TableRow
                  key={sample.id}
                  selected={active}
                  selectedTone="canary"
                  onClick={() => onSelectSample(sample.id)}
                >
                  <TableCell column="select">
                    <SelectionBox
                      checked={selected}
                      ariaLabel={`${t('datasets.detail.selectSample')} ${sample.id}`}
                      onClick={() => onToggleSelected(sample.id)}
                    />
                  </TableCell>
                  {fields.map((field) => {
                    if (field.role === 'image') {
                      const rawValue = sample.data[field.name];
                      const imageReferences = getImageReferences(rawValue);
                      const value = getPrimaryImageReference(rawValue);
                      return (
                        <TableCell key={fieldColumnKey(field)} column={fieldColumnKey(field)}>
                          <ImageCell
                            value={value}
                            fieldName={field.name}
                            imageCount={Math.max(imageReferences.length, 1)}
                            onPreview={() => setPreview({ field: field.name, value })}
                          />
                        </TableCell>
                      );
                    }
                    const value = String(getDisplayValue(sample.data[field.name]) ?? '');
                    return (
                      <TableCell key={fieldColumnKey(field)} column={fieldColumnKey(field)}>
                        <span
                          className={cn(
                            'line-clamp-2 break-words',
                            field.role === 'id' && 'font-mono text-[11.5px]',
                            field.role === 'expected' && 'font-mono text-[12.5px]',
                            active && field.role === 'id' && 'font-semibold',
                          )}
                        >
                          {value || '-'}
                        </span>
                      </TableCell>
                    );
                  })}
                  <TableCell column="actions" className="text-right">
                    <div className="inline-flex w-full items-center justify-end gap-0.5">
                      <TableActionIconButton
                        label={t('datasets.action.editName')}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectSample(sample.id);
                        }}
                      >
                        <Edit3 className="size-3.5" />
                      </TableActionIconButton>
                      <TableActionIconButton
                        label={t('datasets.detail.deleteSample')}
                        className="size-7 text-destructive hover:text-destructive"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteSample(sample.id);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </TableActionIconButton>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <ResourcePaginationFooter
        pageIndex={safePageIndex}
        pageCount={pageCount}
        pageSize={pageSize}
        pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
        previousPageLabel={t('common.previousPage')}
        nextPageLabel={t('common.nextPage')}
        onPageChange={onPageIndexChange}
        onPageSizeChange={(size) => {
          setPageSize(size);
          onPageIndexChange(0);
        }}
      />

      <ImagePreviewDialog
        open={preview !== null}
        onOpenChange={(next) => {
          if (!next) setPreview(null);
        }}
        fieldName={preview?.field ?? ''}
        value={preview?.value ?? ''}
      />
    </div>
  );
}
