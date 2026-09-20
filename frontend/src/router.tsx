import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { AvailabilityPage } from '@/features/availability/AvailabilityPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { DomainsPage } from '@/features/domains/DomainsPage';
import { PricesPage } from '@/features/prices/PricesPage';
import { SyncPage } from '@/features/sync/SyncPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/domains', element: <DomainsPage /> },
      // The detail drawer is a route, not local state, so it is deep-linkable
      // and Escape (which navigates back to /domains) restores the list intact.
      { path: '/domains/:id', element: <DomainsPage /> },
      { path: '/availability', element: <AvailabilityPage /> },
      { path: '/prices', element: <PricesPage /> },
      { path: '/sync', element: <SyncPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
