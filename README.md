# Coretax Faktur Pajak Downloader

Scaffold Chrome Extension Manifest V3 untuk menambahkan checkbox dan bulk download PDF pada halaman submitted return sheets di Coretax.

## Isi scaffold

- `manifest.json`: registrasi content script untuk domain Coretax
- `content.js`: inject toolbar bulk action, checkbox per baris, dan antrean klik tombol PDF
- `content.css`: styling toolbar, checkbox, dan highlight baris

## Fitur versi awal

- Menambahkan checkbox di kolom aksi tiap baris
- Menambahkan checkbox `Bulk` pada header tabel
- Toolbar tambahan dengan aksi:
  - `Pilih semua halaman ini`
  - `Reset pilihan`
  - `Download terpilih`
  - `Stop`
- Delay antar download bisa diatur
- Re-inject otomatis saat tabel PrimeNG render ulang

## Batasan saat ini

- Seleksi hanya berlaku untuk baris yang terlihat pada halaman aktif
- Download dilakukan dengan menekan tombol PDF bawaan Coretax satu per satu
- Browser mungkin meminta izin `Automatic downloads` jika banyak file dipicu beruntun

## Cara pakai

1. Buka Chrome atau Brave.
2. Masuk ke `chrome://extensions`.
3. Aktifkan `Developer mode`.
4. Klik `Load unpacked`.
5. Pilih folder `/Users/fernandojulian/project/distribution-retail/extension-faktur-pajak-downloader`.
6. Buka halaman Coretax `submitted-returnsheets`.
7. Pilih baris yang diinginkan, lalu klik `Download terpilih`.

## Catatan pengembangan berikutnya

- Tambah dukungan lintas pagination
- Simpan preferensi delay ke `chrome.storage`
- Tambah mode langsung memanggil API download jika nanti payload per baris bisa diambil stabil
