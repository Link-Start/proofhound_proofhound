import type { LucideIcon } from 'lucide-react';

export type NavLink = {
  title: string;
  url: string;
  icon?: LucideIcon;
  badge?: string;
  disabled?: boolean;
};

export type NavCollapsible = {
  title: string;
  icon?: LucideIcon;
  badge?: string;
  disabled?: boolean;
  url?: never;
  items: NavLink[];
};

export type NavItem = NavLink | NavCollapsible;

export type NavGroup = {
  title: string;
  items: NavItem[];
  hideTitle?: boolean;
};

export type Project = {
  id: string;
  name: string;
};
