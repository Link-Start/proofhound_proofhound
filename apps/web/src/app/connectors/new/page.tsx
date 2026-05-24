'use client';

import { useProjectContext } from '@/providers/project-context-provider';
import { ConnectorFormPage } from '../_components/connector-form-page';

export default function ProjectConnectorNewPage() {
  const { projectId } = useProjectContext();
  return <ConnectorFormPage mode="create" projectId={projectId} />;
}
