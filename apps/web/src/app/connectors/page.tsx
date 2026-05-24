'use client';

import { useProjectContext } from '@/providers/project-context-provider';
import { ConnectorsListPage } from './_components/connectors-list-page';

export default function ProjectConnectorsPage() {
  const { projectId } = useProjectContext();
  return <ConnectorsListPage projectId={projectId} />;
}
