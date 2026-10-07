<script lang="ts">
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth';

  const session = useSession();

  $effect(() => {
    if ($session.isPending) return;
    goto($session.data?.user ? '/groups' : '/login', { replaceState: true });
  });
</script>

<p class="muted">Loading…</p>
