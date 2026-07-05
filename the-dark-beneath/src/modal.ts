// Shared DOM chrome: the parchment modal and the title-screen overlay.
// Kept tiny and import-free so ui.ts and chargen.ts can both use it.

const $ = (id: string) => document.getElementById(id)!;

export function openModal(html: string) {
  $('modal').innerHTML = html;
  $('modal-overlay').classList.remove('hidden');
}

export function closeModal() {
  $('modal-overlay').classList.add('hidden');
}

export function modalOpen(): boolean {
  return !$('modal-overlay').classList.contains('hidden');
}

export function showTitleScreen(show: boolean) {
  $('title-screen').classList.toggle('hidden', !show);
}

export function titleVisible(): boolean {
  return !$('title-screen').classList.contains('hidden');
}
