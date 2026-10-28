<script lang="ts">
  import { getConfirmState, resolveConfirm } from '$lib/confirm.svelte';

  const state = getConfirmState();
</script>

<svelte:window
  onkeydown={(e) => {
    if (state.open && e.key === 'Escape') resolveConfirm(false);
  }}
/>

{#if state.open}
  <div class="backdrop" role="presentation" onclick={() => resolveConfirm(false)}>
    <div
      class="dialog card"
      role="alertdialog"
      aria-modal="true"
      aria-label={state.title ?? 'Confirm'}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      {#if state.title}<h2>{state.title}</h2>{/if}
      <p class="muted">{state.message}</p>
      <div class="actions">
        <button class="btn ghost" onclick={() => resolveConfirm(false)}>
          {state.cancelLabel}
        </button>
        <button
          class="btn"
          class:danger={state.danger}
          onclick={() => resolveConfirm(true)}
        >
          {state.confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.5);
    padding: 20px;
  }
  .dialog {
    max-width: 380px;
    width: 100%;
  }
  .dialog h2 {
    margin: 0 0 8px;
    font-size: 17px;
  }
  .dialog p {
    margin: 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
  }
</style>
