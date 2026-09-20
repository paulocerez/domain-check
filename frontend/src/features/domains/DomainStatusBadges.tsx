import type { DomainDTO } from '@domain-check/shared';
import { Ban, Lock, RefreshCcwDot, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

const PROCESS_LABEL: Record<string, string> = {
  UPDATE_IN_PROGRESS: 'Updating',
  TRANSFER_OUT_IN_PROGRESS: 'Transferring out',
  TRANSFER_IN_IN_PROGRESS: 'Transferring in',
  DELETE_IN_PROGRESS: 'Deleting',
  UPDATE_FAILED: 'Update failed',
};

const COMPLIANCE_LABEL: Record<string, string> = {
  EMAIL_VERIFICATION_RUNNING: 'Email verification',
  DATA_QUALITY_RUNNING: 'Data quality check',
  NOMINET_LOCKED: 'Nominet locked',
  EMAIL_VERIFICATION_LOCK: 'Email verification lock',
};

/**
 * Renders a badge only when there is something abnormal to say.
 *
 * A row per domain reading "ACTIVE" is pure noise; the value of this column is
 * that anything appearing in it is worth looking at.
 */
export function DomainStatusBadges({ domain, compact = false }: { domain: DomainDTO; compact?: boolean }) {
  const badges: React.ReactNode[] = [];

  if (domain.syncState === 'missing') {
    badges.push(
      <Tooltip
        key="missing"
        content="The registrar stopped returning this domain. Its cost data is kept until you archive it."
      >
        <Badge variant="urgent">
          <ShieldAlert className="size-3" />
          Not at registrar
        </Badge>
      </Tooltip>,
    );
  }

  if (domain.syncState === 'archived') {
    badges.push(
      <Badge key="archived" variant="outline">
        Archived
      </Badge>,
    );
  }

  if (domain.cancelOnExpire) {
    badges.push(
      <Tooltip key="cancel" content="This domain is set to be cancelled when it expires — it will not renew.">
        <Badge variant="urgent">
          <Ban className="size-3" />
          Cancels on expiry
        </Badge>
      </Tooltip>,
    );
  }

  // `provisioningStatus` carries whichever registrar's vocabulary produced the
  // row — IONOS's REGISTRATION_IN_PROGRESS/EXPIRING, or GoDaddy's PENDING_*/
  // AWAITING_*/EXPIRED. Both map onto the same two badges.
  if (domain.pendingProvisioning || domain.provisioningStatus === 'REGISTRATION_IN_PROGRESS') {
    badges.push(
      <Badge key="provisioning" variant="accent">
        <RefreshCcwDot className="size-3" />
        Registering
      </Badge>,
    );
  }

  if (domain.provisioningStatus === 'EXPIRING' || domain.provisioningStatus === 'EXPIRED') {
    badges.push(
      <Badge key="expiring" variant="urgent">
        {domain.provisioningStatus === 'EXPIRED' ? 'Expired' : 'Expiring'}
      </Badge>,
    );
  }

  if (
    domain.provisioningStatus === 'TRANSFERRED_OUT' ||
    domain.provisioningStatus === 'CANCELLED' ||
    domain.provisioningStatus === 'CANCELLED_HELD' ||
    domain.provisioningStatus === 'CANCELLED_REDEEMABLE'
  ) {
    badges.push(
      <Badge key="gone" variant="urgent">
        {domain.provisioningStatus === 'TRANSFERRED_OUT' ? 'Transferred out' : 'Cancelled'}
      </Badge>,
    );
  }

  if (domain.processStatus) {
    badges.push(
      <Tooltip key="process" content={domain.transferStatus ? `Transfer status: ${domain.transferStatus}` : ''}>
        <Badge variant="warning">{PROCESS_LABEL[domain.processStatus] ?? domain.processStatus}</Badge>
      </Tooltip>,
    );
  }

  if (domain.complianceStatus) {
    badges.push(
      <Badge key="compliance" variant="warning">
        {COMPLIANCE_LABEL[domain.complianceStatus] ?? domain.complianceStatus}
      </Badge>,
    );
  }

  if (!compact && (domain.domainLock || domain.transferLock)) {
    badges.push(
      <Tooltip
        key="lock"
        content={[domain.domainLock ? 'Domain lock' : null, domain.transferLock ? 'Transfer lock' : null]
          .filter(Boolean)
          .join(' · ')}
      >
        <Badge variant="neutral">
          <Lock className="size-3" />
          Locked
        </Badge>
      </Tooltip>,
    );
  }

  if (badges.length === 0) return null;
  return <div className="flex flex-wrap items-center gap-1">{badges}</div>;
}
