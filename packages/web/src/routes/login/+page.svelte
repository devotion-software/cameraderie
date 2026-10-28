<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authClient, signIn, useSession } from '$lib/auth';

  const session = useSession();
  const redirectTo = $derived(page.url.searchParams.get('redirect') || '/groups');

  let step: 'email' | 'otp' = $state('email');
  let email = $state('');
  let otp = $state('');
  let error = $state('');
  let busy = $state(false);

  $effect(() => {
    if ($session.data?.user) goto(redirectTo, { replaceState: true });
  });

  async function sendCode(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      const res = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
      if (res.error) {
        error = res.error.message ?? 'Something went wrong';
      } else {
        step = 'otp';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong';
    } finally {
      busy = false;
    }
  }

  async function verifyCode(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      const res = await authClient.signIn.emailOtp({ email, otp });
      if (res.error) {
        error = res.error.message ?? 'Invalid or expired code';
      } else {
        goto(redirectTo);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong';
    } finally {
      busy = false;
    }
  }

  async function withSocial(provider: 'google' | 'apple') {
    error = '';
    busy = true;
    try {
      const res = await signIn.social({ provider, callbackURL: redirectTo });
      if (res.error) error = res.error.message ?? 'Something went wrong';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong';
    } finally {
      busy = false;
    }
  }

  async function withPasskey() {
    error = '';
    busy = true;
    try {
      const res = await signIn.passkey();
      if (res?.error) error = res.error.message ?? 'Passkey sign-in failed';
      else goto(redirectTo);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong';
    } finally {
      busy = false;
    }
  }
</script>

<div class="auth">
  <div class="card">
    <p class="eyebrow">Cameraderie</p>
    <h1>Welcome</h1>
    <p class="muted">Private groups for full-fidelity photos and videos.</p>
    <p class="muted small invite-note">
      Cameraderie is invite only right now. If you know someone who's already signed up, you can
      ask them to invite you to a group.
    </p>

    <div class="social">
      <button class="btn secondary" type="button" disabled={busy} onclick={() => withSocial('google')}>
        Continue with Google
      </button>
      <button class="btn secondary" type="button" disabled={busy} onclick={() => withSocial('apple')}>
        Continue with Apple
      </button>
      <button class="btn secondary" type="button" disabled={busy} onclick={withPasskey}>
        Continue with a passkey
      </button>
    </div>

    <div class="divider"><span>or</span></div>

    {#if step === 'email'}
      <form onsubmit={sendCode}>
        <label>
          <span>Email</span>
          <input class="input" type="email" bind:value={email} required autocomplete="email" />
        </label>
        {#if error}<p class="error">{error}</p>{/if}
        <button class="btn" type="submit" disabled={busy || !email}>
          {busy ? 'Please wait…' : 'Send sign-in code'}
        </button>
      </form>
    {:else}
      <form onsubmit={verifyCode}>
        <p class="muted small">
          We sent a code to <strong>{email}</strong>. It expires in 5 minutes.
        </p>
        <label>
          <span>Code</span>
          <input
            class="input"
            bind:value={otp}
            required
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength={6}
          />
        </label>
        {#if error}<p class="error">{error}</p>{/if}
        <button class="btn" type="submit" disabled={busy || otp.length < 6}>
          {busy ? 'Please wait…' : 'Continue'}
        </button>
        <button
          class="btn ghost"
          type="button"
          disabled={busy}
          onclick={() => {
            step = 'email';
            otp = '';
            error = '';
          }}
        >
          Use a different email
        </button>
      </form>
    {/if}
  </div>
</div>

<style>
  .auth {
    max-width: 400px;
    margin: 64px auto;
  }
  .auth .card {
    border-radius: var(--radius-lg);
  }
  .social {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 20px;
  }
  .divider {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 18px 0;
    color: var(--text-dim);
    font-size: 12px;
  }
  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  label span {
    font-size: 13px;
    color: var(--text-dim);
  }
  .small {
    font-size: 12px;
  }
  .invite-note {
    margin-top: 4px;
  }
</style>
