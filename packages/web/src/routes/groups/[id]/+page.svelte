<script lang="ts">
  import { fade, scale, slide } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { flip } from 'svelte/animate';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth';
  import { api } from '$lib/api';
  import { uploadFile, checkDuplicate, sha256Hex } from '$lib/upload';
  import { formatBytes, formatDuration } from '$lib/format';
  import { downloadOne, requestZip, QUALITY_OPTIONS } from '$lib/download';
  import type { Group, MediaItem, MediaLocation, Member, Profile } from '$lib/types';
  import type { DownloadQuality } from '@cameraderie/shared';
  import Avatar from '$lib/components/Avatar.svelte';
  import LeafletMap from '$lib/components/LeafletMap.svelte';
  import Dropdown from '$lib/components/Dropdown.svelte';
  import UploaderFilter from '$lib/components/UploaderFilter.svelte';
  import { confirmDialog } from '$lib/confirm.svelte';

  const session = useSession();
  const groupId = $derived(page.params.id as string);

  let group = $state<Group | null>(null);
  let items = $state<MediaItem[]>([]);
  let members = $state<Member[]>([]);
  let nextCursor = $state<string | null>(null);
  let loading = $state(true);
  let error = $state('');

  let likedOnly = $state(false);
  let selectedUploaderIds = $state<string[]>([]);
  let sort = $state<'newest' | 'oldest'>('newest');
  const uploaderQueryPart = $derived(
    selectedUploaderIds.length > 0 ? `&uploaderIds=${selectedUploaderIds.join(',')}` : '',
  );
  const feedQuery = $derived(`liked=${likedOnly}&sort=${sort}${uploaderQueryPart}`);
  const SORT_OPTIONS: { value: 'newest' | 'oldest'; label: string }[] = [
    { value: 'newest', label: 'Newest first' },
    { value: 'oldest', label: 'Oldest first' },
  ];
  const uploaderOptions = $derived(
    members
      .filter((m) => m.mediaCount > 0)
      .map((m) => ({ userId: m.userId, name: m.name, avatarUrl: m.avatarUrl, mediaCount: m.mediaCount }))
      .sort((a, b) => b.mediaCount - a.mediaCount),
  );

  let showMap = $state(false);
  let mapLocations = $state<MediaLocation[] | null>(null);
  // Which filters `mapLocations` was last fetched with, so toggling them
  // while on the map re-fetches instead of reusing a stale set.
  let mapLocationsKey = $state<string | null>(null);
  const currentMapKey = $derived(`${likedOnly}|${selectedUploaderIds.join(',')}`);
  let mapLoading = $state(false);

  async function loadMapLocations() {
    mapLoading = true;
    try {
      const res = await api.get<{ media: MediaLocation[] }>(
        `/groups/${groupId}/media/locations?liked=${likedOnly}${uploaderQueryPart}`,
      );
      mapLocations = res.media;
      mapLocationsKey = currentMapKey;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load map';
    } finally {
      mapLoading = false;
    }
  }

  async function setView(wantMap: boolean) {
    if (showMap === wantMap) return;
    showMap = wantMap;
    if (showMap && (mapLocations === null || mapLocationsKey !== currentMapKey)) {
      await loadMapLocations();
    }
  }

  const TILE_FIT_KEY = 'cameraderie:tileFit';
  let tileFit = $state<'square' | 'contain'>('square');
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(TILE_FIT_KEY);
    if (saved === 'contain' || saved === 'square') tileFit = saved;
  }
  function setTileFit(next: 'square' | 'contain') {
    tileFit = next;
    localStorage.setItem(TILE_FIT_KEY, next);
  }

  // Remembered per-user upload preferences (fetched in load(), below), offered
  // as the preselected choice each time someone picks files to upload rather
  // than living behind a permanent header control.
  let defaultKeepGps = $state(true);
  let defaultKeepCameraExif = $state(true);
  let pendingUploadFiles = $state<File[] | null>(null);
  let pendingKeepGps = $state(true);
  let pendingKeepCameraExif = $state(true);

  function cancelPendingUpload() {
    pendingUploadFiles = null;
  }

  async function confirmPendingUpload() {
    const files = pendingUploadFiles;
    if (!files) return;
    const keepGps = pendingKeepGps;
    const keepCameraExif = pendingKeepCameraExif;
    pendingUploadFiles = null;
    if (keepGps !== defaultKeepGps || keepCameraExif !== defaultKeepCameraExif) {
      defaultKeepGps = keepGps;
      defaultKeepCameraExif = keepCameraExif;
      api
        .patch('/me/upload-defaults', { defaultKeepGps: keepGps, defaultKeepCameraExif: keepCameraExif })
        .catch(() => {});
    }
    await startUploads(files, keepGps, keepCameraExif);
  }

  interface DuplicatePrompt {
    file: File;
    filePreviewUrl: string | null;
    filePreviewLoading: boolean;
    duplicate: MediaItem;
    remaining: number;
    resolve: (ok: boolean) => void;
  }
  let duplicatePrompt = $state<DuplicatePrompt | null>(null);
  let filePreviewBroken = $state(false);
  // When a batch upload turns up several duplicates in a row, "Skip all" /
  // "Upload all" sets this so the rest of the batch applies the same choice
  // without re-prompting. Reset at the start of each startUploads() call.
  let bulkDuplicateAction = $state<'skip' | 'upload' | null>(null);

  function confirmDuplicate(file: File, duplicate: MediaItem, remaining: number): Promise<boolean> {
    if (bulkDuplicateAction) return Promise.resolve(bulkDuplicateAction === 'upload');
    return new Promise((resolve) => {
      // Browsers can't decode HEIC/HEIF in an <img> at all (except Safari),
      // and often report an empty `type` for them too, so detect by
      // extension and convert to a JPEG blob ourselves for the preview.
      const isHeic = /\.(heic|heif)$/i.test(file.name);
      filePreviewBroken = false;
      duplicatePrompt = {
        file,
        filePreviewUrl: !isHeic && file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        filePreviewLoading: isHeic,
        duplicate,
        remaining,
        resolve,
      };
      if (isHeic) void convertHeicPreview(file);
    });
  }

  async function convertHeicPreview(file: File) {
    try {
      const { heicTo } = await import('heic-to');
      const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.8 });
      const url = URL.createObjectURL(blob);
      if (duplicatePrompt?.file === file) {
        duplicatePrompt.filePreviewUrl = url;
        duplicatePrompt.filePreviewLoading = false;
      } else {
        URL.revokeObjectURL(url);
      }
    } catch {
      if (duplicatePrompt?.file === file) duplicatePrompt.filePreviewLoading = false;
    }
  }

  function resolveDuplicatePrompt(ok: boolean) {
    if (!duplicatePrompt) return;
    if (duplicatePrompt.filePreviewUrl) URL.revokeObjectURL(duplicatePrompt.filePreviewUrl);
    duplicatePrompt.resolve(ok);
    duplicatePrompt = null;
  }

  function resolveDuplicatePromptForAll(ok: boolean) {
    bulkDuplicateAction = ok ? 'upload' : 'skip';
    resolveDuplicatePrompt(ok);
  }

  const MEMBER_AVATAR_LIMIT = 5;
  const overflowing = $derived(members.length > MEMBER_AVATAR_LIMIT);
  const visibleMembers = $derived(
    members.slice(0, overflowing ? MEMBER_AVATAR_LIMIT - 1 : MEMBER_AVATAR_LIMIT),
  );
  const extraMemberCount = $derived(members.length - visibleMembers.length);

  let fileInput = $state<HTMLInputElement>();

  interface UploadTask {
    name: string;
    fraction: number;
    error?: string;
  }
  let uploads = $state<UploadTask[]>([]);

  const statsLine = $derived.by(() => {
    if (!group) return '';
    const counts = [
      `${group.photoCount} photo${group.photoCount === 1 ? '' : 's'}`,
      `${group.videoCount} video${group.videoCount === 1 ? '' : 's'}`,
    ];
    const bytesPart =
      group.myBytes !== undefined
        ? `${formatBytes(group.totalBytes)} (${formatBytes(group.myBytes)} yours)`
        : formatBytes(group.totalBytes);
    return `${counts.join(', ')} · ${bytesPart}`;
  });

  $effect(() => {
    if ($session.isPending) return;
    if (!$session.data?.user) {
      goto('/login', { replaceState: true });
      return;
    }
    void load();
  });

  // Auto-refresh while anything is still processing.
  $effect(() => {
    const processing = items.some((i) => i.state === 'processing' || i.state === 'uploading');
    if (!processing) return;
    const t = setInterval(() => void refreshFeed(), 4000);
    return () => clearInterval(t);
  });

  async function load() {
    loading = true;
    error = '';
    try {
      const [g, m, me] = await Promise.all([
        api.get<{ group: Group }>(`/groups/${groupId}`),
        api.get<{ members: Member[] }>(`/groups/${groupId}/members`),
        api.get<{ user: Profile }>('/me').catch(() => null),
      ]);
      group = g.group;
      members = m.members;
      if (me) {
        defaultKeepGps = me.user.defaultKeepGps;
        defaultKeepCameraExif = me.user.defaultKeepCameraExif;
        downloadQuality = me.user.defaultDownloadQuality;
      }
      await refreshFeed();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load group';
    } finally {
      loading = false;
    }
  }

  async function refreshFeed() {
    const res = await api.get<{ media: MediaItem[]; nextCursor: string | null }>(
      `/groups/${groupId}/media?limit=30&${feedQuery}`,
    );
    items = res.media;
    nextCursor = res.nextCursor;
    saveFeedOrder();
  }

  async function loadMore() {
    if (!nextCursor) return;
    const res = await api.get<{ media: MediaItem[]; nextCursor: string | null }>(
      `/groups/${groupId}/media?limit=30&${feedQuery}&before=${encodeURIComponent(nextCursor)}`,
    );
    items = [...items, ...res.media];
    nextCursor = res.nextCursor;
    saveFeedOrder();
  }

  // The media detail page needs to know prev/next in the currently viewed
  // order to support arrow-key navigation there. There's no "siblings"
  // endpoint, so stash the ordered id list the grid is showing right now —
  // the detail page reads it back by group id when it wants to step.
  const FEED_ORDER_KEY = `cameraderie:feedOrder:${groupId}`;
  function saveFeedOrder() {
    if (typeof sessionStorage === 'undefined') return;
    try {
      sessionStorage.setItem(FEED_ORDER_KEY, JSON.stringify(items.map((m) => m.id)));
    } catch {
      // sessionStorage can throw in private-browsing edge cases; navigation
      // still works, it just loses prev/next on the detail page.
    }
  }

  async function onFilterChange() {
    loading = true;
    try {
      await refreshFeed();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load media';
    } finally {
      loading = false;
    }
  }

  function onFiles(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    pendingKeepGps = defaultKeepGps;
    pendingKeepCameraExif = defaultKeepCameraExif;
    pendingUploadFiles = files;
  }

  async function startUploads(files: File[], keepGps: boolean, keepCameraExif: boolean) {
    bulkDuplicateAction = null;
    for (const [i, file] of files.entries()) {
      uploads = [...uploads, { name: file.name, fraction: 0 }];
      // Index into the reactive `uploads` array itself (not the plain object
      // literal above) — $state proxifies the array on assignment, so a
      // closure over the pre-proxy object never triggers a re-render.
      const idx = uploads.length - 1;
      try {
        const checksumSha256 = await sha256Hex(file);
        const duplicate = await checkDuplicate(groupId, checksumSha256).catch(() => null);
        if (duplicate) {
          const ok = await confirmDuplicate(file, duplicate, files.length - i - 1);
          if (!ok) {
            uploads[idx].error = 'Skipped — duplicate';
            continue;
          }
        }
        await uploadFile(
          groupId,
          file,
          (f) => {
            uploads[idx].fraction = f;
          },
          { keepGps, keepCameraExif, checksumSha256 },
        );
      } catch (err) {
        uploads[idx].error = err instanceof Error ? err.message : 'Upload failed';
      }
    }
    await refreshFeed();
    // Clear successfully finished tasks after a moment — errored/skipped
    // ones stick around until the user dismisses them.
    setTimeout(() => {
      uploads = uploads.filter((u) => u.error);
    }, 1500);
  }

  function dismissUpload(name: string) {
    uploads = uploads.filter((u) => u.name !== name);
  }

  function clearErroredUploads() {
    uploads = uploads.filter((u) => !u.error);
  }

  const amGroupAdmin = $derived(group?.myRole === 'owner' || group?.myRole === 'admin');
  const canManageCover = $derived(amGroupAdmin);
  const myUserId = $derived($session.data?.user?.id);
  // Matches the API's own-upload-or-owner rule (see routes/media.ts).
  function canDeleteMedia(m: MediaItem): boolean {
    return m.uploaderId === myUserId || group?.myRole === 'owner';
  }

  let settingCover = $state<string | null>(null);
  async function setCover(mediaId: string, e?: MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (!group) return;
    settingCover = mediaId;
    try {
      const res = await api.put<{ coverMediaId: string; coverThumbnailUrl: string | null }>(
        `/groups/${groupId}/cover`,
        { mediaId },
      );
      group = {
        ...group,
        coverMediaId: res.coverMediaId,
        coverThumbnailUrl: res.coverThumbnailUrl,
      };
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to set cover photo';
    } finally {
      settingCover = null;
    }
  }

  let showEditGroup = $state(false);
  let editName = $state('');
  let savingGroup = $state(false);
  let removingCover = $state(false);

  function openEditGroup() {
    if (!group) return;
    editName = group.name;
    showEditGroup = true;
  }

  function closeEditGroup() {
    showEditGroup = false;
  }

  async function saveGroupName(e: SubmitEvent) {
    e.preventDefault();
    if (!group || !editName.trim()) return;
    savingGroup = true;
    try {
      const res = await api.patch<{ group: Group }>(`/groups/${groupId}`, {
        name: editName.trim(),
      });
      group = { ...group, name: res.group.name };
      showEditGroup = false;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to update group';
    } finally {
      savingGroup = false;
    }
  }

  async function removeCover() {
    if (!group) return;
    const ok = await confirmDialog({
      title: 'Remove cover photo',
      message: 'Remove the group cover photo? You can set a new one later from any photo.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    removingCover = true;
    try {
      await api.del(`/groups/${groupId}/cover`);
      group = { ...group, coverMediaId: null, coverThumbnailUrl: null };
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to remove cover photo';
    } finally {
      removingCover = false;
    }
  }

  let contextMenu = $state<{ x: number; y: number; mediaId: string } | null>(null);
  const contextMenuItem = $derived(
    contextMenu ? (items.find((i) => i.id === contextMenu!.mediaId) ?? null) : null,
  );
  function onTileContextMenu(mediaId: string, e: MouseEvent) {
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY, mediaId };
  }
  function closeContextMenu() {
    contextMenu = null;
  }
  async function setCoverFromMenu() {
    const mediaId = contextMenu?.mediaId;
    closeContextMenu();
    if (mediaId) await setCover(mediaId);
  }

  async function deleteMedia(mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    const ok = await confirmDialog({
      title: mediaIds.length === 1 ? 'Delete permanently' : `Delete ${mediaIds.length} items`,
      message:
        mediaIds.length === 1
          ? 'Delete this permanently? This removes the original too.'
          : `Delete ${mediaIds.length} items permanently? This removes the originals too.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const deleted = new Set<string>();
    for (const id of mediaIds) {
      try {
        await api.del(`/media/${id}`);
        deleted.add(id);
      } catch (err) {
        error = err instanceof Error ? err.message : 'Failed to delete';
      }
    }
    items = items.filter((i) => !deleted.has(i.id));
    if (deleted.size > 0 && selected.size > 0) {
      const next = new Set(selected);
      for (const id of deleted) next.delete(id);
      selected = next;
    }
  }

  async function deleteFromMenu() {
    const mediaId = contextMenu?.mediaId;
    closeContextMenu();
    if (mediaId) await deleteMedia([mediaId]);
  }

  async function deleteSelected() {
    await deleteMedia([...selected]);
  }

  let selectMode = $state(false);
  let selected = $state<Set<string>>(new Set());
  let downloading = $state(false);
  let showDownloadMenu = $state(false);
  let showDownloadAllMenu = $state(false);
  let downloadQuality = $state<DownloadQuality>('original');

  function toggleSelectMode() {
    selectMode = !selectMode;
    selected = new Set();
  }

  function toggleSelected(mediaId: string, e?: MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    const next = new Set(selected);
    if (next.has(mediaId)) next.delete(mediaId);
    else next.add(mediaId);
    selected = next;
  }

  async function toggleFavourite(m: MediaItem, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !m.favourited;
    m.favourited = next;
    m.favouriteCount += next ? 1 : -1;
    try {
      if (next) await api.put(`/media/${m.id}/favourite`);
      else await api.del(`/media/${m.id}/favourite`);
    } catch {
      m.favourited = !next;
      m.favouriteCount += next ? -1 : 1;
    }
  }

  let lightboxIndex = $state<number | null>(null);
  const lightboxItem = $derived(lightboxIndex !== null ? (items[lightboxIndex] ?? null) : null);

  function onTileClick(mediaId: string, index: number, e: MouseEvent) {
    if (selectMode) {
      toggleSelected(mediaId, e);
      return;
    }
    // Alt/Option-click opens the full-screen lightbox instead of navigating
    // to the photo page. Everything else (plain click, cmd/ctrl/shift-click,
    // middle-click) behaves like a normal link.
    if (e.altKey && !e.metaKey && !e.ctrlKey && e.button === 0) {
      e.preventDefault();
      lightboxIndex = index;
    }
  }

  function openLightboxFromMenu() {
    const mediaId = contextMenu?.mediaId;
    closeContextMenu();
    if (!mediaId) return;
    const index = items.findIndex((i) => i.id === mediaId);
    if (index !== -1) lightboxIndex = index;
  }

  function closeLightbox() {
    lightboxIndex = null;
  }

  function lightboxStep(delta: number) {
    if (lightboxIndex === null) return;
    const next = lightboxIndex + delta;
    if (next >= 0 && next < items.length) lightboxIndex = next;
  }

  function onLightboxKeydown(e: KeyboardEvent) {
    if (lightboxIndex === null) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowRight') lightboxStep(1);
    else if (e.key === 'ArrowLeft') lightboxStep(-1);
  }

  function selectAll() {
    selected = new Set(items.map((m) => m.id));
  }

  function clearSelection() {
    selected = new Set();
  }

  function onDownloadClick(e: MouseEvent) {
    e.stopPropagation();
    showDownloadMenu = true;
  }

  async function downloadIndividually() {
    if (downloading || selected.size === 0) return;
    showDownloadMenu = false;
    downloading = true;
    try {
      for (const id of selected) {
        const m = items.find((i) => i.id === id);
        if (!m) continue;
        try {
          await downloadOne(id, m.filename, downloadQuality);
        } catch (err) {
          error = err instanceof Error ? err.message : `Failed to download ${m.filename}`;
        }
        // Stagger so the browser doesn't block a burst of auto-downloads.
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      downloading = false;
    }
  }

  async function downloadAsZip() {
    if (downloading || selected.size === 0) return;
    showDownloadMenu = false;
    downloading = true;
    try {
      await requestZip([...selected], downloadQuality, `${group?.name ?? 'photos'}.zip`);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to download zip';
    } finally {
      downloading = false;
    }
  }

  // The zip endpoint caps how many files it will bundle in one request; a
  // "download all" on a big album splits into multiple zips of this size.
  const ZIP_CHUNK_SIZE = 100;

  /** Page through the whole album (not just what's currently loaded). */
  async function fetchAllMedia(): Promise<{ id: string; filename: string }[]> {
    const all: { id: string; filename: string }[] = [];
    let cursor: string | null = null;
    let hasMore = true;
    while (hasMore) {
      const qs: string = cursor ? `?limit=100&before=${encodeURIComponent(cursor)}` : '?limit=100';
      const res: { media: MediaItem[]; nextCursor: string | null } = await api.get(
        `/groups/${groupId}/media${qs}`,
      );
      all.push(...res.media.map((m: MediaItem) => ({ id: m.id, filename: m.filename })));
      cursor = res.nextCursor;
      hasMore = cursor !== null;
    }
    return all;
  }

  function onDownloadAllClick(e: MouseEvent) {
    e.stopPropagation();
    showDownloadAllMenu = true;
  }

  async function downloadAllIndividually() {
    if (downloading) return;
    showDownloadAllMenu = false;
    downloading = true;
    try {
      const all = await fetchAllMedia();
      for (const m of all) {
        try {
          await downloadOne(m.id, m.filename, downloadQuality);
        } catch (err) {
          error = err instanceof Error ? err.message : `Failed to download ${m.filename}`;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to download album';
    } finally {
      downloading = false;
    }
  }

  async function downloadAllAsZip() {
    if (downloading) return;
    showDownloadAllMenu = false;
    downloading = true;
    try {
      const all = await fetchAllMedia();
      const ids = all.map((m) => m.id);
      const chunkCount = Math.ceil(ids.length / ZIP_CHUNK_SIZE);
      for (let i = 0; i < chunkCount; i++) {
        const chunk = ids.slice(i * ZIP_CHUNK_SIZE, (i + 1) * ZIP_CHUNK_SIZE);
        const base = group?.name ?? 'photos';
        const filename = chunkCount > 1 ? `${base} (${i + 1} of ${chunkCount}).zip` : `${base}.zip`;
        await requestZip(chunk, downloadQuality, filename);
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to download album';
    } finally {
      downloading = false;
    }
  }
</script>

<svelte:window
  onclick={() => {
    closeContextMenu();
    showDownloadMenu = false;
    showDownloadAllMenu = false;
  }}
  onkeydown={(e) => {
    onLightboxKeydown(e);
    if (e.key !== 'Escape') return;
    closeContextMenu();
    showDownloadMenu = false;
    showDownloadAllMenu = false;
    if (pendingUploadFiles) cancelPendingUpload();
    if (duplicatePrompt) resolveDuplicatePrompt(false);
  }}
/>

{#if pendingUploadFiles}
  <div
    class="backdrop"
    role="presentation"
    onclick={cancelPendingUpload}
    transition:fade={{ duration: 150 }}
  >
    <div
      class="dialog card"
      role="alertdialog"
      aria-modal="true"
      aria-label="Upload options"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      transition:scale={{ duration: 150, start: 0.96 }}
    >
      <h2>
        Upload {pendingUploadFiles.length}
        {pendingUploadFiles.length === 1 ? 'file' : 'files'}
      </h2>
      <label class="option-row">
        <input type="checkbox" bind:checked={pendingKeepGps} />
        <span>Keep location (GPS)</span>
      </label>
      <label class="option-row">
        <input type="checkbox" bind:checked={pendingKeepCameraExif} />
        <span>Keep camera &amp; lens details</span>
      </label>
      <div class="modal-actions">
        <button class="btn ghost" onclick={cancelPendingUpload}>Cancel</button>
        <button class="btn" onclick={confirmPendingUpload}>Upload</button>
      </div>
    </div>
  </div>
{/if}

{#if duplicatePrompt}
  <div
    class="backdrop"
    role="presentation"
    onclick={() => resolveDuplicatePrompt(false)}
    transition:fade={{ duration: 150 }}
  >
    <div
      class="dialog card duplicate-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-label="Possible duplicate"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      transition:scale={{ duration: 150, start: 0.96 }}
    >
      <h2>Possible duplicate</h2>
      <p class="muted">
        "{duplicatePrompt.file.name}" looks identical to a photo already in this group{duplicatePrompt
          .duplicate.uploaderName
          ? ` (uploaded by ${duplicatePrompt.duplicate.uploaderName})`
          : ''}.
      </p>
      <div class="duplicate-compare">
        <div class="duplicate-side">
          <span class="muted small">New file</span>
          {#if duplicatePrompt.filePreviewUrl && !filePreviewBroken}
            <img
              src={duplicatePrompt.filePreviewUrl}
              alt={duplicatePrompt.file.name}
              onerror={() => (filePreviewBroken = true)}
            />
          {:else if duplicatePrompt.filePreviewLoading}
            <div class="duplicate-placeholder">
              <span class="spinner"></span>
              <span class="duplicate-placeholder-note">Generating preview…</span>
            </div>
          {:else}
            <div class="duplicate-placeholder">
              <span class="duplicate-placeholder-name">{duplicatePrompt.file.name}</span>
              <span class="duplicate-placeholder-note">No preview available</span>
            </div>
          {/if}
        </div>
        <div class="duplicate-side">
          <span class="muted small">Already in this group</span>
          {#if duplicatePrompt.duplicate.thumbnailUrl}
            <img
              src={duplicatePrompt.duplicate.thumbnailUrl}
              alt={duplicatePrompt.duplicate.filename}
            />
          {:else}
            <div class="duplicate-placeholder">{duplicatePrompt.duplicate.filename}</div>
          {/if}
        </div>
      </div>
      <div class="modal-actions">
        {#if duplicatePrompt.remaining > 0}
          <button class="btn ghost" onclick={() => resolveDuplicatePromptForAll(false)}
            >Skip all</button
          >
        {/if}
        <button class="btn ghost" onclick={() => resolveDuplicatePrompt(false)}>Skip</button>
        <button class="btn" onclick={() => resolveDuplicatePrompt(true)}>Upload anyway</button>
        {#if duplicatePrompt.remaining > 0}
          <button class="btn" onclick={() => resolveDuplicatePromptForAll(true)}
            >Upload all</button
          >
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if group}
  <div class="head">
    <div>
      <a href="/groups" class="back"><span class="arrow">←</span> Groups</a>
      <div class="title-row">
        <h1>{group.name}</h1>
        {#if amGroupAdmin}
          <button class="icon-btn edit-group-btn" onclick={openEditGroup} aria-label="Edit group">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M4 20h4l10.5-10.5a1.5 1.5 0 0 0 0-2.12l-1.88-1.88a1.5 1.5 0 0 0-2.12 0L4 16v4Z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        {/if}
      </div>
      {#if group.description}<p class="muted">{group.description}</p>{/if}
      <p class="muted stats">{statsLine}</p>
    </div>
    <span class="spacer"></span>
    <div class="actions">
      <a class="btn secondary member-link" href="/groups/{groupId}/members">
        Members
        {#if visibleMembers.length > 0}
          <span class="member-avatars">
            {#each visibleMembers as m (m.userId)}
              <span class="member-avatar"><Avatar name={m.name} src={m.avatarUrl} size={22} /></span>
            {/each}
            {#if extraMemberCount > 0}
              <span class="member-avatar more">+{extraMemberCount}</span>
            {/if}
          </span>
        {/if}
      </a>
      {#if items.length > 0}
        <div class="download-wrap">
          <button class="btn secondary" onclick={onDownloadAllClick} disabled={downloading}>
            {downloading ? 'Downloading…' : 'Download all'}
          </button>
          {#if showDownloadAllMenu}
            <div
              class="download-menu"
              onclick={(e) => e.stopPropagation()}
              transition:scale={{ duration: 150, start: 0.96 }}
            >
              <div class="quality-row">
                <span class="muted">Quality</span>
                <Dropdown options={QUALITY_OPTIONS} bind:value={downloadQuality} label="Quality" />
              </div>
              <button class="context-item" onclick={downloadAllIndividually}>
                Download individually
              </button>
              <button class="context-item" onclick={downloadAllAsZip}>Download as a zip</button>
            </div>
          {/if}
        </div>
      {/if}
      <button class="btn" onclick={() => fileInput?.click()}>Upload</button>
      <input
        bind:this={fileInput}
        type="file"
        multiple
        accept="image/*,video/*,.dng,.cr2,.cr3,.nef,.arw,.raf,.rw2,.orf"
        onchange={onFiles}
        hidden
      />
    </div>
  </div>

  {#if showEditGroup}
    <form
      class="card edit-group"
      onsubmit={saveGroupName}
      transition:slide={{ duration: 180 }}
    >
      <label class="field">
        <span class="muted">Group name</span>
        <input class="input" bind:value={editName} maxlength={80} required />
      </label>
      <div class="field">
        <span class="muted">Cover photo</span>
        <div class="cover-row">
          {#if group.coverThumbnailUrl}
            <img class="cover-thumb" src={group.coverThumbnailUrl} alt="" />
            <button
              type="button"
              class="btn secondary"
              onclick={removeCover}
              disabled={removingCover}
            >
              {removingCover ? 'Removing…' : 'Remove cover'}
            </button>
          {:else}
            <span class="muted">No cover set.</span>
          {/if}
        </div>
        <span class="muted hint">
          Set a new cover from any photo's right-click menu in the grid below.
        </span>
      </div>
      <div class="edit-actions">
        <button class="btn" type="submit" disabled={savingGroup || !editName.trim()}>
          {savingGroup ? 'Saving…' : 'Save'}
        </button>
        <button class="btn ghost" type="button" onclick={closeEditGroup} disabled={savingGroup}>
          Cancel
        </button>
      </div>
    </form>
  {/if}

  {#if uploads.length}
    <div class="card uploads" transition:slide={{ duration: 180 }}>
      {#if uploads.some((u) => u.error)}
        <div class="uploads-head">
          <span class="spacer"></span>
          <button class="btn ghost" onclick={clearErroredUploads}>Clear</button>
        </div>
      {/if}
      {#each uploads as u (u.name)}
        <div class="up" transition:slide={{ duration: 180 }} animate:flip={{ duration: 200 }}>
          <span class="upname">{u.name}</span>
          {#if u.error}
            <span class="error inline">{u.error}</span>
            <button class="dismiss" onclick={() => dismissUpload(u.name)} title="Dismiss"
              >&times;</button
            >
          {:else if u.fraction >= 1}
            <span class="up-done" in:scale={{ duration: 260, start: 0.5, easing: backOut }}
              >✓ Uploaded</span
            >
          {:else}
            <div class="bar"><div class="fill" style="width: {u.fraction * 100}%"></div></div>
            <span class="muted pct">{Math.round(u.fraction * 100)}%</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{/if}

{#if error}<p class="error" transition:slide={{ duration: 150 }}>{error}</p>{/if}

{#if selectMode}
  <div class="card select-bar">
    <span>{selected.size} selected</span>
    <span class="spacer"></span>
    <button class="btn ghost" onclick={selectAll} disabled={selected.size === items.length}>
      Select all
    </button>
    <button class="btn ghost" onclick={clearSelection} disabled={selected.size === 0}>
      Clear
    </button>
    <button class="btn danger" onclick={deleteSelected} disabled={selected.size === 0}>
      Delete
    </button>
    <div class="download-wrap">
      <button class="btn" onclick={onDownloadClick} disabled={selected.size === 0 || downloading}>
        {downloading ? 'Downloading…' : 'Download'}
      </button>
      {#if showDownloadMenu}
        <div
          class="download-menu"
          onclick={(e) => e.stopPropagation()}
          transition:scale={{ duration: 150, start: 0.96 }}
        >
          <div class="quality-row">
            <span class="muted">Quality</span>
            <Dropdown options={QUALITY_OPTIONS} bind:value={downloadQuality} label="Quality" />
          </div>
          <button class="context-item" onclick={downloadIndividually}>
            Download individually ({selected.size} files)
          </button>
          <button class="context-item" onclick={downloadAsZip}> Download as a zip </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if group}
  <div class="filter-bar">
    {#if !showMap && items.length > 0}
      <button class="btn secondary" onclick={toggleSelectMode}>
        {selectMode ? 'Cancel' : 'Select'}
      </button>
    {/if}
    <button
      class="btn secondary"
      class:active={likedOnly}
      onclick={() => {
        likedOnly = !likedOnly;
        if (showMap) void loadMapLocations();
        else void onFilterChange();
      }}
    >
      ♥ Liked only
    </button>
    {#if uploaderOptions.length > 1}
      <UploaderFilter
        options={uploaderOptions}
        bind:selected={selectedUploaderIds}
        onchange={() => {
          if (showMap) void loadMapLocations();
          else void onFilterChange();
        }}
      />
    {/if}
    <div class="view-controls">
      {#if items.length > 0}
        <div class="fit-toggle" role="group" aria-label="View">
          <button
            class="fit-btn"
            class:active={!showMap}
            aria-pressed={!showMap}
            onclick={() => setView(false)}
          >
            Grid
          </button>
          <button
            class="fit-btn"
            class:active={showMap}
            aria-pressed={showMap}
            onclick={() => setView(true)}
          >
            Map
          </button>
        </div>
      {/if}
      {#if !showMap}
        <div class="fit-toggle" role="group" aria-label="Image fit">
          <button
            class="fit-btn"
            class:active={tileFit === 'square'}
            onclick={() => setTileFit('square')}
          >
            Fit to square
          </button>
          <button
            class="fit-btn"
            class:active={tileFit === 'contain'}
            onclick={() => setTileFit('contain')}
          >
            Contain
          </button>
        </div>
        <div class="sort-select">
          <span class="muted">Sort</span>
          <Dropdown
            options={SORT_OPTIONS}
            bind:value={sort}
            label="Sort"
            onchange={() => void onFilterChange()}
          />
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if showMap}
  <div class="card map-card">
    {#if mapLoading}
      <p class="muted">Loading map…</p>
    {:else if !mapLocations || mapLocations.length === 0}
      <p class="muted">No photos or videos with location data yet.</p>
    {:else}
      <LeafletMap
        height="480px"
        markers={mapLocations.map((m) => ({
          id: m.id,
          lat: m.latitude,
          lng: m.longitude,
          href: `/media/${m.id}`,
          popupHtml: `<strong>${m.filename}</strong>`,
        }))}
      />
    {/if}
  </div>
{:else if loading && items.length === 0}
  <p class="muted">Loading…</p>
{:else if items.length === 0}
  <p class="muted">
    {likedOnly
      ? 'No liked photos or videos yet.'
      : 'No photos or videos yet. Hit Upload to add the first.'}
  </p>
{:else}
  <div class="grid" class:contain-tiles={tileFit === 'contain'}>
    {#each items as m, i (m.id)}
      <a
        class="tile"
        class:selected={selected.has(m.id)}
        href="/media/{m.id}"
        title={m.filename}
        oncontextmenu={(e) => onTileContextMenu(m.id, e)}
        onclick={(e) => onTileClick(m.id, i, e)}
        in:fade={{ duration: 150 }}
        animate:flip={{ duration: 200 }}
      >
        <div class="tile-surface">
          {#if selectMode}
            <button
              class="overlay check"
              class:checked={selected.has(m.id)}
              onclick={(e) => toggleSelected(m.id, e)}
              title={selected.has(m.id) ? 'Deselect' : 'Select'}
            >
              {selected.has(m.id) ? '✓' : ''}
            </button>
          {/if}
          {#if m.thumbnailUrl}
            <div class="media">
              <img src={m.thumbnailUrl} alt={m.filename} loading="lazy" />
              {#if m.kind === 'video'}
                <span class="overlay play">▶ {formatDuration(m.durationMs) ?? ''}</span>
              {:else if m.kind === 'raw'}
                <span class="overlay kind">RAW</span>
              {/if}
              <button
                class="overlay fav"
                class:visible={m.favouriteCount > 0}
                onclick={(e) => toggleFavourite(m, e)}
                title={m.favourited ? 'Unlike' : 'Like'}
              >
                {#key m.favourited}
                  <span
                    class="heart"
                    class:mine={m.favourited}
                    in:scale={{ duration: 280, start: 0.4, easing: backOut }}
                    >{m.favourited ? '♥' : '♡'}</span
                  >
                {/key}
                {#if m.favouriteCount > 0}{m.favouriteCount}{/if}
              </button>
            </div>
          {:else if m.state === 'failed'}
            <div class="placeholder failed">⚠︎ failed</div>
          {:else}
            <div class="placeholder"><span class="spinner"></span> processing</div>
          {/if}
        </div>
      </a>
    {/each}
  </div>

  {#if nextCursor}
    <div class="more">
      <button class="btn secondary" onclick={loadMore}>Load more</button>
    </div>
  {/if}
{/if}

{#if contextMenu}
  <div
    class="context-menu"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
    onclick={(e) => e.stopPropagation()}
    transition:scale={{ duration: 120, start: 0.96 }}
  >
    <button class="context-item" onclick={openLightboxFromMenu}>⛶ Open fullscreen</button>
    {#if canManageCover}
      {#if group?.coverMediaId === contextMenu.mediaId}
        <span class="context-item disabled">★ Current group cover</span>
      {:else}
        <button class="context-item" onclick={setCoverFromMenu}>★ Set as group cover</button>
      {/if}
    {/if}
    {#if contextMenuItem && canDeleteMedia(contextMenuItem)}
      <button class="context-item danger" onclick={deleteFromMenu}>Delete</button>
    {/if}
  </div>
{/if}

{#if lightboxItem}
  <div
    class="lightbox"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={closeLightbox}
    transition:fade={{ duration: 150 }}
  >
    <button class="lightbox-close" onclick={closeLightbox} aria-label="Close">✕</button>
    {#if lightboxIndex !== null && lightboxIndex > 0}
      <button
        class="lightbox-nav prev"
        onclick={(e) => {
          e.stopPropagation();
          lightboxStep(-1);
        }}
        aria-label="Previous"
      >
        ‹
      </button>
    {/if}
    {#if lightboxIndex !== null && lightboxIndex < items.length - 1}
      <button
        class="lightbox-nav next"
        onclick={(e) => {
          e.stopPropagation();
          lightboxStep(1);
        }}
        aria-label="Next"
      >
        ›
      </button>
    {/if}
    <div
      class="lightbox-content"
      onclick={(e) => e.stopPropagation()}
      transition:scale={{ duration: 150, start: 0.96 }}
    >
      {#if lightboxItem.kind === 'video'}
        {#if lightboxItem.previewUrl}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={lightboxItem.previewUrl} controls playsinline autoplay></video>
        {:else if lightboxItem.thumbnailUrl}
          <img src={lightboxItem.thumbnailUrl} alt={lightboxItem.filename} class="blurry" />
        {/if}
      {:else if lightboxItem.previewUrl}
        <img src={lightboxItem.previewUrl} alt={lightboxItem.filename} />
      {:else if lightboxItem.thumbnailUrl}
        <img src={lightboxItem.thumbnailUrl} alt={lightboxItem.filename} class="blurry" />
      {:else}
        <div class="placeholder"><span class="spinner"></span> processing</div>
      {/if}
      <a class="lightbox-details" href="/media/{lightboxItem.id}">Open full page ›</a>
    </div>
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .head h1 {
    margin: 4px 0 0;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .edit-group-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity var(--dur-fast) ease,
      background-color var(--dur-fast) ease,
      color var(--dur-fast) ease;
  }
  .title-row:hover .edit-group-btn,
  .title-row:focus-within .edit-group-btn {
    opacity: 1;
  }
  .edit-group-btn:hover {
    background: var(--accent-soft);
    color: var(--text);
  }
  .stats {
    font-size: 13px;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
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
    margin: 0 0 14px;
    font-size: 17px;
  }
  .option-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 16px;
  }
  .duplicate-dialog {
    max-width: 480px;
  }
  .duplicate-compare {
    display: flex;
    gap: 12px;
    margin-top: 12px;
  }
  .duplicate-side {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .duplicate-side img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
  }
  .duplicate-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    aspect-ratio: 1;
    padding: 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text-dim);
    font-size: 12px;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .duplicate-placeholder-note {
    font-size: 11px;
    opacity: 0.75;
  }
  .map-card {
    margin-bottom: 20px;
  }
  .member-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .member-avatars {
    display: flex;
  }
  .member-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--surface-strong);
    margin-left: -8px;
  }
  .member-avatar:first-child {
    margin-left: 0;
  }
  .member-avatar.more {
    background: var(--surface-2);
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 700;
  }
  .edit-group {
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cover-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .cover-thumb {
    width: 72px;
    height: 48px;
    object-fit: cover;
    border-radius: 8px;
    background: var(--surface-2);
  }
  .edit-actions {
    display: flex;
    gap: 10px;
  }
  .hint {
    font-size: 12px;
  }
  .uploads {
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
  }
  .uploads-head {
    display: flex;
    align-items: center;
  }
  .uploads-head .btn {
    padding: 4px 10px;
    font-size: 12px;
  }
  .up {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .dismiss {
    border: none;
    background: transparent;
    color: var(--text-dim);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
  }
  .dismiss:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  .upname {
    flex: 0 0 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
  .inline {
    padding: 2px 8px;
    font-size: 12px;
  }
  .up-done {
    font-size: 12px;
    color: var(--accent);
    font-weight: 600;
    display: inline-block;
  }
  .bar {
    flex: 1;
    height: 6px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-1), var(--accent-2));
    transition: width 0.2s ease;
  }
  .pct {
    width: 40px;
    text-align: right;
    font-size: 12px;
  }
  .filter-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    row-gap: 10px;
    column-gap: 12px;
    margin-bottom: 16px;
  }
  .filter-bar .btn.secondary {
    height: 36px;
    padding: 0 18px;
  }
  .filter-bar .btn.active {
    border-color: var(--accent);
    color: var(--accent);
  }
  .view-controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px;
    margin-left: auto;
  }
  .fit-toggle {
    display: flex;
    align-items: stretch;
    height: 36px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .fit-btn {
    display: flex;
    align-items: center;
    padding: 0 14px;
    font-size: 13px;
    border: none;
    background: var(--surface-2);
    color: var(--text-dim);
    cursor: pointer;
    transition:
      background-color var(--dur-fast) ease,
      color var(--dur-fast) ease;
  }
  .fit-btn.active {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .sort-select {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .sort-select :global(.dropdown-trigger) {
    height: 36px;
    padding: 0 12px;
  }
  .select-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    padding: 10px 16px;
    /* Tiles below each get their own stacking context (backdrop-filter), so
       without this the dropdown menu paints behind them despite z-index. */
    z-index: 10;
  }
  .download-wrap {
    position: relative;
  }
  .download-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 100;
    min-width: 220px;
    padding: 6px;
    border-radius: var(--radius-sm);
    background: var(--surface-strong);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--border);
    box-shadow: 0 16px 36px -14px hsl(var(--shadow-color) / 0.5);
  }
  .quality-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 10px 10px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }
  .quality-row span {
    font-size: 12px;
  }
  .tile {
    position: relative;
    aspect-ratio: 1;
    display: block;
  }
  /* The hover lift/scale lives on this inner element rather than .tile
     itself — .tile also carries animate:flip during reordering/filtering,
     and a CSS transition fighting a Svelte-driven transform on the same
     element is what made that animation look glitchy. */
  .tile-surface {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-2);
    backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--border);
    box-shadow: inset 0 1px 0 var(--glass-highlight);
    transition:
      transform 0.2s cubic-bezier(0.2, 0.8, 0.3, 1),
      box-shadow 0.2s ease,
      border-color 0.2s ease;
  }
  .tile.selected .tile-surface {
    border-color: var(--accent);
    box-shadow:
      0 0 0 2px var(--accent),
      inset 0 1px 0 var(--glass-highlight);
  }
  .overlay.check {
    left: 8px;
    top: 8px;
    width: 22px;
    height: 22px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.8);
    cursor: pointer;
    z-index: 1;
    transition:
      background-color var(--dur-fast) ease,
      border-color var(--dur-fast) ease;
  }
  .overlay.check.checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  .tile:hover .tile-surface {
    transform: translateY(-4px) scale(1.02);
    border-color: var(--accent);
    box-shadow:
      0 16px 36px -14px hsl(var(--shadow-color) / 0.5),
      0 0 0 1px var(--accent-soft),
      inset 0 1px 0 var(--glass-highlight);
  }
  .media {
    position: relative;
    width: 100%;
    height: 100%;
    display: block;
  }
  .tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .contain-tiles .tile {
    container-type: size;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .contain-tiles .tile-surface {
    overflow: visible;
    background: none;
    backdrop-filter: none;
    border: none;
    box-shadow: none;
  }
  .contain-tiles .tile:hover .tile-surface {
    border-color: transparent;
    box-shadow: none;
  }
  .contain-tiles .tile .media {
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 100%;
    display: inline-flex;
  }
  .contain-tiles .tile img {
    width: auto;
    height: auto;
    max-width: 100cqw;
    max-height: 100cqh;
    object-fit: contain;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    box-shadow: inset 0 1px 0 var(--glass-highlight);
    transition:
      box-shadow 0.2s ease,
      border-color 0.2s ease;
  }
  .contain-tiles .tile.selected img {
    border-color: var(--accent);
    box-shadow:
      0 0 0 2px var(--accent),
      inset 0 1px 0 var(--glass-highlight);
  }
  .contain-tiles .tile:hover img {
    border-color: var(--accent);
    box-shadow:
      0 16px 36px -14px hsl(var(--shadow-color) / 0.5),
      0 0 0 1px var(--accent-soft),
      inset 0 1px 0 var(--glass-highlight);
  }
  .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-dim);
    font-size: 13px;
  }
  .placeholder.failed {
    color: var(--danger);
  }
  .overlay {
    position: absolute;
    font-size: 12px;
    padding: 2px 7px;
    border-radius: 999px;
    background: rgba(10, 10, 26, 0.55);
    backdrop-filter: blur(6px);
    color: white;
  }
  .overlay.play {
    left: 8px;
    bottom: 8px;
  }
  .overlay.kind {
    left: 8px;
    top: 8px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .overlay.fav {
    right: 8px;
    bottom: 8px;
    border: none;
    cursor: pointer;
    z-index: 1;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-fast) ease;
  }
  .overlay.fav.visible,
  .tile:hover .overlay.fav,
  .overlay.fav:focus-visible {
    opacity: 1;
    pointer-events: auto;
  }
  .overlay.fav .heart {
    display: inline-block;
  }
  .overlay.fav .heart.mine {
    color: var(--danger);
  }
  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .more {
    margin-top: 20px;
    text-align: center;
  }
  .context-menu {
    position: fixed;
    z-index: 100;
    min-width: 190px;
    padding: 6px;
    border-radius: var(--radius-sm);
    background: var(--surface-strong);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--border);
    box-shadow: 0 16px 36px -14px hsl(var(--shadow-color) / 0.5);
  }
  .context-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border: none;
    background: none;
    border-radius: calc(var(--radius-sm) - 4px);
    font-size: 13px;
    cursor: pointer;
    color: var(--text);
    transition:
      background-color var(--dur-fast) ease,
      color var(--dur-fast) ease;
  }
  .context-item:not(.disabled):hover {
    background: var(--accent-soft);
  }
  .context-item.disabled {
    color: var(--text-dim);
    cursor: default;
  }
  .context-item.danger {
    color: var(--danger);
  }
  .context-item.danger:hover {
    background: var(--danger-soft);
  }
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.85);
  }
  .lightbox-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    max-width: min(92vw, 1100px);
    max-height: 90vh;
  }
  .lightbox-content img,
  .lightbox-content video {
    max-width: min(92vw, 1100px);
    max-height: 80vh;
    border-radius: var(--radius-sm);
    display: block;
  }
  .lightbox-content img.blurry {
    filter: blur(8px);
    opacity: 0.7;
  }
  .lightbox-details {
    color: rgba(255, 255, 255, 0.85);
    font-size: 13px;
  }
  .lightbox-close {
    position: absolute;
    top: 16px;
    right: 20px;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: none;
    background: rgb(255 255 255 / 0.12);
    color: #fff;
    font-size: 16px;
    cursor: pointer;
    transition: background-color var(--dur-fast) ease;
  }
  .lightbox-close:hover {
    background: rgb(255 255 255 / 0.22);
  }
  .lightbox-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: none;
    background: rgb(255 255 255 / 0.12);
    color: #fff;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    transition: background-color var(--dur-fast) ease;
  }
  .lightbox-nav:hover {
    background: rgb(255 255 255 / 0.22);
  }
  .lightbox-nav.prev {
    left: 20px;
  }
  .lightbox-nav.next {
    right: 20px;
  }
</style>
