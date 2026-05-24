import type { SidebarSide, SidebarVariant } from './app-sidebar';

export const LAYOUT_VARIANT_STORAGE_KEY = 'proofhound.layout.variant';
export const LAYOUT_COLLAPSIBLE_STORAGE_KEY = 'proofhound.layout.collapsible';
export const SIDEBAR_SIDE_STORAGE_KEY = 'proofhound.sidebar.side';

export type LayoutMode = 'default' | 'compact' | 'full';

export type LayoutPreferences = {
  defaultLayoutMode: LayoutMode;
  defaultSidebarSide: SidebarSide;
  defaultSidebarVariant: SidebarVariant;
  layoutMode: LayoutMode;
  resetLayoutPreferences: () => void;
  setLayoutMode: (layoutMode: LayoutMode) => void;
  setSidebarSide: (side: SidebarSide) => void;
  setSidebarVariant: (variant: SidebarVariant) => void;
  sidebarSide: SidebarSide;
  sidebarVariant: SidebarVariant;
};
