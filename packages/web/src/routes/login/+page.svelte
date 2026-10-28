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
        <svg class="provider-icon" viewBox="0 0 48 48" aria-hidden="true">
          <path
            fill="#FFC107"
            d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
          />
          <path
            fill="#FF3D00"
            d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4c-7.4 0-13.8 4.1-17.1 10.1z"
          />
          <path
            fill="#4CAF50"
            d="M24 44c5.5 0 10.4-1.9 14.1-5l-6.5-5.4C29.6 35.4 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.6 5.1C9.1 39.6 15.9 44 24 44z"
          />
          <path
            fill="#1976D2"
            d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.5 5.4C39.9 37.3 44 31.4 44 24c0-1.3-.1-2.7-.4-3.5z"
          />
        </svg>
        Continue with Google
      </button>
      <button class="btn secondary" type="button" disabled={busy} onclick={() => withSocial('apple')}>
        <svg class="provider-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
          <path
            d="M16.365 1.43c0 1.14-.42 2.07-1.26 2.79-.84.72-1.76 1.11-2.76 1.17-.06-1.14.33-2.1 1.17-2.88.84-.78 1.8-1.14 2.85-1.08zm3.33 16.68c-.42.96-.93 1.86-1.53 2.7-.81 1.14-1.47 1.92-1.98 2.34-.78.69-1.62 1.05-2.52 1.08-.66 0-1.44-.18-2.34-.57-.9-.39-1.71-.57-2.43-.57-.75 0-1.59.18-2.52.57-.93.39-1.68.6-2.25.63-.87.03-1.74-.33-2.61-1.11-.57-.48-1.26-1.29-2.07-2.46-.87-1.26-1.59-2.73-2.16-4.41C.39 14.25 0 12.6 0 10.98c0-1.86.4-3.48 1.2-4.86.63-1.11 1.47-1.98 2.52-2.64 1.05-.66 2.19-1 3.42-1.02.69 0 1.59.21 2.73.63 1.14.42 1.86.63 2.19.63.24 0 1.02-.24 2.37-.72 1.26-.45 2.34-.63 3.21-.57 2.37.18 4.14 1.11 5.34 2.82-2.1 1.32-3.15 3.12-3.15 5.37 0 1.77.57 3.24 1.71 4.41.51.54 1.08.96 1.71 1.26-.15.42-.3.81-.45 1.17z"
          />
        </svg>
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
  .social .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .provider-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
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
