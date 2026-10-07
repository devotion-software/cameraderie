<script lang="ts">
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth';
  import { api } from '$lib/api';
  import { formatDate } from '$lib/format';

  interface ReportRow {
    report: { id: string; mediaId: string; reason: string; createdAt: string };
    mediaFilename: string;
    mediaKind: string;
    mediaState: string;
    groupId: string;
    groupName: string;
    reporterName: string;
    reporterEmail: string;
  }

  const session = useSession();
  let rows = $state<ReportRow[]>([]);
  let loading = $state(true);
  let error = $state('');

  $effect(() => {
    if ($session.isPending) return;
    const user = $session.data?.user as { role?: string } | undefined;
    if (!user) {
      goto('/login', { replaceState: true });
      return;
    }
    if (user.role !== 'admin') {
      error = 'Admin access required.';
      loading = false;
      return;
    }
    void load();
  });

  async function load() {
    loading = true;
    try {
      const res = await api.get<{ reports: ReportRow[] }>('/admin/reports?status=open');
      rows = res.reports;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load reports';
    } finally {
      loading = false;
    }
  }

  async function resolve(id: string, action: 'actioned' | 'dismissed') {
    if (action === 'actioned' && !confirm('Take this media down permanently?')) return;
    try {
      await api.post(`/admin/reports/${id}/resolve`, { action });
      rows = rows.filter((r) => r.report.id !== id);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to resolve';
    }
  }
</script>

<h1>Open reports</h1>

{#if error}<p class="error">{error}</p>{/if}

{#if loading}
  <p class="muted">Loading…</p>
{:else if rows.length === 0}
  <p class="muted">No open reports. 🎉</p>
{:else}
  <div class="list">
    {#each rows as r (r.report.id)}
      <div class="card report">
        <div class="info">
          <div class="row">
            <a href="/media/{r.report.mediaId}"><strong>{r.mediaFilename}</strong></a>
            <span class="badge">{r.mediaKind}</span>
            <span class="badge">{r.mediaState}</span>
          </div>
          <p class="reason">“{r.report.reason}”</p>
          <p class="muted small">
            in {r.groupName} · reported by {r.reporterName} ({r.reporterEmail}) ·
            {formatDate(r.report.createdAt)}
          </p>
        </div>
        <div class="actions">
          <button class="btn danger" onclick={() => resolve(r.report.id, 'actioned')}>
            Take down
          </button>
          <button class="btn secondary" onclick={() => resolve(r.report.id, 'dismissed')}>
            Dismiss
          </button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .report {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }
  .info {
    flex: 1;
  }
  .reason {
    margin: 8px 0 4px;
  }
  .small {
    font-size: 12px;
    margin: 0;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
