<script lang="ts">
  // Starter draft — see the banner. Replace bracketed placeholders and have the
  // whole document reviewed by a qualified solicitor / DPO before any public launch.
  const LAST_UPDATED = '2026-10-08';
  const OPERATOR = '[OPERATOR LEGAL NAME]';
  const CONTACT = '[privacy@your-domain]';
</script>

<svelte:head><title>Privacy Policy — Cameraderie</title></svelte:head>

<article class="legal">
  <div class="draft" role="note">
    ⚠️ <strong>Draft — not yet legally reviewed.</strong> Starter wording to be
    checked by a qualified solicitor / data-protection adviser and have its
    placeholders completed before launch. It is not legal advice. If you operate in
    the UK you may also need to register with the ICO.
  </div>

  <h1>Privacy Policy</h1>
  <p class="muted">Last updated: {LAST_UPDATED}</p>

  <h2>1. Controller</h2>
  <p>
    {OPERATOR} is the data controller for Cameraderie. Contact:
    <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
  </p>

  <h2>2. What we collect</h2>
  <ul>
    <li><strong>Account data:</strong> your name, email address, and a hashed password.</li>
    <li>
      <strong>Content you upload:</strong> your photos and videos, stored
      byte-for-byte in Cloudflare R2, plus thumbnails/previews we derive from them.
      By default we strip location/EXIF metadata from previews.
    </li>
    <li><strong>Usage &amp; metering:</strong> storage used, group membership, favourites.</li>
    <li><strong>Technical data:</strong> IP address and session information, for security.</li>
    <li>
      <strong>Consent record:</strong> the time you confirmed you are 18+ and
      accepted these policies.
    </li>
  </ul>

  <h2>3. Legal bases</h2>
  <p>
    We process your data to perform our contract with you (providing the Service),
    on the basis of your consent (sign-up; optional features), and for our
    legitimate interests in keeping the Service secure and lawful.
  </p>

  <h2>4. How your content is stored &amp; who can see it</h2>
  <p>
    Storage buckets are private; content is served only through short-lived signed
    URLs and only to members of the groups you share it with. We do not sell your
    data or use your content for advertising or model training.
  </p>

  <h2>5. Processors we share data with</h2>
  <ul>
    <li><strong>Cloudflare R2</strong> — object storage for originals and derivatives.</li>
    <li><strong>Stripe</strong> / <strong>RevenueCat</strong> — payment processing for paid plans.</li>
    <li><strong>Sentry</strong> — error monitoring (may include limited technical identifiers).</li>
    <li>[Your email provider] — transactional email, once configured.</li>
  </ul>
  <p>[Confirm each processor, its location, and that a data-processing agreement is in place.]</p>

  <h2>6. Content safety</h2>
  <p>
    To keep the Service lawful we run automated safety checks on uploads. Suspected
    illegal content is quarantined and preserved as evidence, and reported to the
    relevant authorities (in the UK, the Internet Watch Foundation and the police).
  </p>

  <h2>7. Retention</h2>
  <p>
    We keep your data while your account is active. When you delete your account we
    erase your uploaded originals and account record [state any limited retention
    for legal/safety or backup rotation].
  </p>

  <h2>8. Your rights</h2>
  <p>Under UK/EU data protection law you can:</p>
  <ul>
    <li>
      <strong>Access / export</strong> your data — download a copy from Settings, or
      ask us.
    </li>
    <li><strong>Erase</strong> your data — delete your account from Settings.</li>
    <li><strong>Rectify</strong> inaccurate data, and object to or restrict processing.</li>
    <li>Complain to the ICO (or your local supervisory authority).</li>
  </ul>

  <h2>9. Age restriction</h2>
  <p>The Service is for adults (18+). We do not knowingly collect data from children.</p>

  <h2>10. International transfers</h2>
  <p>
    Some processors may store or process data outside the UK/EEA under appropriate
    safeguards [confirm transfer mechanisms].
  </p>

  <h2>11. Changes &amp; contact</h2>
  <p>
    We will notify material changes in-app or by email. Questions or requests:
    <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
  </p>

  <p class="muted"><a href="/legal/terms">Terms of Service →</a></p>
</article>

<style>
  .legal {
    max-width: 720px;
    margin: 24px auto 64px;
    line-height: 1.6;
  }
  .legal h2 {
    margin-top: 28px;
    font-size: 18px;
  }
  .draft {
    border: 1px solid rgba(255, 193, 7, 0.5);
    background: rgba(255, 193, 7, 0.1);
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 20px;
    font-size: 14px;
  }
</style>
