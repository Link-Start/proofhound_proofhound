import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import type { SidebarSide } from './app-sidebar';

interface HeaderProps {
  children?: ReactNode;
  fixed?: boolean;
  className?: string;
  sidebarSide?: SidebarSide;
}

export function Header({ children, fixed = false, className, sidebarSide = 'left' }: HeaderProps) {
  const trigger = (
    <SidebarTrigger className={sidebarSide === 'right' ? '-mr-1' : '-ml-1'} side={sidebarSide} />
  );

  return (
    <header
      className={cn(
        'flex h-14 shrink-0 items-center gap-2 border-b px-4 transition-all',
        fixed && 'sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        className,
      )}
    >
      {sidebarSide === 'left' && (
        <>
          {trigger}
          <Separator orientation="vertical" className="mr-2 h-4" />
        </>
      )}
      {children}
      {sidebarSide === 'right' && (
        <>
          <Separator orientation="vertical" className="ml-2 h-4" />
          {trigger}
        </>
      )}
    </header>
  );
}
