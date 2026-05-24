type EmptyRoutePageProps = {
  testId: string;
};

export function EmptyRoutePage({ testId }: EmptyRoutePageProps) {
  return <main className="min-h-[calc(100svh-3.5rem)] bg-background" data-testid={testId} />;
}
