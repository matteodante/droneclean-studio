<p align="center">
  <a href="https://droneclean.app/tr/"><img src="https://droneclean.app/media/studio-demo.webp" alt="Sağdaki Claude Code, MCP sunucusu üzerinden DroneClean Studio'da altı drone klibini kurguluyor; 47 kat hızlı gösteriliyor" width="100%"></a>
</p>

<h1 align="center">DroneClean Studio</h1>

<p align="center">
  <a href="README.md">English</a> &nbsp;·&nbsp;
  <a href="README.it.md">Italiano</a> &nbsp;·&nbsp;
  <a href="README.es.md">Español</a> &nbsp;·&nbsp;
  <a href="README.fr.md">Français</a> &nbsp;·&nbsp;
  <a href="README.de.md">Deutsch</a> &nbsp;·&nbsp;
  <a href="README.pt-BR.md">Português (Brasil)</a> &nbsp;·&nbsp;
  <strong>Türkçe</strong> &nbsp;·&nbsp;
  <a href="README.ja.md">日本語</a> &nbsp;·&nbsp;
  <a href="README.ko.md">한국어</a> &nbsp;·&nbsp;
  <a href="README.zh.md">简体中文</a>
</p>

<p align="center">
  <strong>FPV ve drone pilotları için ücretsiz, yerel öncelikli bir video düzenleyici.</strong><br>
  Jiroskopla stabilizasyon, D-Log M renk, optik akışlı ağır çekimle yumuşak hız rampaları ve yapay zekâ ajanları için bir MCP sunucusu.
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest"><img alt="Son sürüm" src="https://img.shields.io/github/v/release/matteodante/droneclean-studio?label=release"></a>
  <a href="LICENSE"><img alt="Lisans: GPL-3.0-or-later" src="https://img.shields.io/badge/licence-GPL--3.0--or--later-blue"></a>
  <img alt="macOS (Apple silicon), Windows ve web" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20web-lightgrey">
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-arm64.dmg"><strong>Mac için indir</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-x64.exe"><strong>Windows için indir</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/tr/studio/"><strong>Tarayıcıda aç</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/tr/">droneclean.app</a>
</p>

Yukarıdaki video, Claude Code'un düzenleyicinin MCP sunucusu üzerinden altı DJI Avata 2 klibini kurgulamasını
gösteriyor; fareye hiç el sürülmüyor. Şarkının vuruşlarını okuyor, her klipten birkaç saniye seçip vuruşa göre kesiyor,
jiroskop verisiyle stabilize ediyor, D-Log M rengini dönüştürüyor, her plana optik akışlı ağır çekim ve hareket
bulanıklığıyla bir hız rampası veriyor ve insanları ile arabaları dışarıda bırakmak için karelere bakıyor. Sürdüğü 19
dakika 47 kat hızlı gösteriliyor. Yaptığı her değişiklik düzenleyicide sıradan bir adımdır; geri alabilir ya da elle
düzenlemeye devam edebilirsin.

## Önce ve sonra

<p align="center">
  <img src="https://droneclean.app/media/reel-before-after.webp" alt="Aynı drone reel'i yan yana: solda çekildiği gibi, sönük ve sarsıntılı; sağda DroneClean Studio'da stabilize edilmiş, renk düzenlemesi yapılmış ve hız rampalı" width="488">
</p>

Aynı uçuşun klipleriyle DroneClean Studio'da kurgulanmış bir reel'in ilk 24 saniyesi. Solda kesimler çekildiği gibi: sönük
D-Log M renk, dronun titreşimi, gerçek hız. Sağda bitmiş kurgu: jiroskop verisiyle stabilize edilmiş, D-Log M
dönüştürülmüş ve renk düzenlemesi yapılmış; hız rampaları, optik akışlı ağır çekim ve hareket bulanıklığıyla.

## Özellikler

- **Jiroskopla stabilizasyon.** DJI ve GoPro dosyaları kameranın hareketini taşır; Studio onları WebAssembly'ye
  derlenmiş [Gyroflow](https://github.com/gyroflow/gyroflow) motoruyla, ayrı bir analiz geçişi olmadan sabitler. 9:16
  bir projedeki 4:3 klip dikey kareyi kendiliğinden doldurur ve anahtar karelerle canlandırılabilen kadraj, konuyu
  görüntüde tutar.
- **Drone görüntüleri için renk.** DJI D-Log M ve D-Log'dan Rec.709'a, `.cube` dosyalarından yaratıcı görünümler, renk
  çarkları, eğriler, ikincil seçiciler, güç pencereleri ve solmuş gökyüzleri için bir gökyüzü gradyanı.
- **Hız.** Yumuşatılmış bölümlü hız eğrileri ve tek tıkla "yumuşak rampa + yakınlaştırma". Hareket bulanıklığı her
  pikselin hareketini optik akış boyunca izler, ağır çekim ise var olan kareleri tekrarlamak yerine ondan yeni kareler
  üretir. Şarkıdan vuruş işaretleri.
- **Anahtar kareler**: her özellikte ve efekt parametresinde, bezier ve yay yumuşatmasıyla.
- **Dışa aktarma.** YouTube 4K ve Instagram Reels için hazır ayarlar, masaüstü uygulamada 10 bit masterlar (ProRes 422
  HQ, HEVC Main 10).
- **Yapay zekâ ajanları.** Yerel bir MCP sunucusu: Claude ya da başka bir MCP istemcisi, düzenleyicinin kullandığı SDK
  ile bir projeyi kurabilir, renk düzenlemesi yapabilir ve dışa aktarabilir; her değişiklik bir geri alma adımıdır.
- **Drone gölgesi giderme**, tek ücretli efekt, DroneClean bulut hizmeti üzerinden.
- **Yerel öncelikli.** Projeler ve medya, seçtiğin bir klasörde kalır; görüntüler bilgisayarından yalnızca gölgeyi
  temizlemek için bir parçasını gönderdiğinde ayrılır.

<p align="center">
  <img src=".github/assets/studio.webp" alt="Zaman çizelgesinde bir plaj klibi ve görüntü üzerinde işaretlenmiş bir drone gölgesiyle DroneClean Studio düzenleyicisi" width="820">
</p>

## Kurulum

**Mac (Apple silicon):** disk görüntüsünü [son sürümden](../../releases/latest) indir ve DroneClean Studio'yu
Uygulamalar'a sürükle. Bu sürüm henüz Apple tarafından imzalanmadığı için macOS ilk seferde durdurur: bir kez açmayı
dene, sonra Sistem Ayarları › Gizlilik ve Güvenlik'e git ve **Yine de Aç**'a bas.

**Windows 10 ve 11 (x64):** `DroneClean-Studio-x64.exe` dosyasını [son sürümden](../../releases/latest) indir ve
çalıştır; kullanıcın için kurulur, yönetici izni istemez. Henüz imzalı olmadığı için SmartScreen ilk seferde durdurur:
**Daha fazla bilgi › Yine de çalıştır**'ı seç. NVIDIA, Intel ve AMD kodlayıcılarıyla kendi FFmpeg'ini de beraberinde
getirir.

**Tarayıcı:** [droneclean.app/studio](https://droneclean.app/tr/studio/), aynı düzenleyiciyi bir bilgisayarda Chrome
veya Edge içinde çalıştırır (File System Access API gerekir).

## Bir yapay zekâ ajanıyla kullan

Ajan erişimi masaüstü uygulamada varsayılan olarak açıktır (yalnızca senin kullanıcın erişebilir; **Ayarlar › Ajan
erişimi › Yapay zekâ ajanlarına izin ver** onu kapatır) ve bu panel tam komutu gösterir. Mac'te Claude Code için:

```sh
claude mcp add droneclean -- "/Applications/DroneClean Studio.app/Contents/Resources/mcp/droneclean-mcp"
```

Windows'ta komut şu dosyayı gösterir:
`%LOCALAPPDATA%\Programs\DroneClean Studio\resources\mcp\droneclean-mcp.cmd` (panel, bunu kullanıcının yoluyla
gösterir).

Sunucunun dört aracı var: `search` (SDK başvurusu, kullanım kılavuzu ve özellik haritası), `run` (düzenleyicinin SDK'sı
üzerinde çalışan bir betik), `frame` (işlenmiş bir kare veya bir kontak sayfası) ve `export`. Sonra yukarıdaki videodaki
gibi kendi sözlerinle bir kurgu iste: "açık projedeki altı klipten, şarkının vuruşuna göre kesilmiş yumuşak bir drone
kurgusu yap".

## Kaynaktan derleme

Apple silicon üzerinde macOS, Node 24, `wasm32-unknown-unknown` hedefiyle Rust, `wasm-bindgen-cli` 0.2.130 ve
`wasm-opt` (Binaryen).

```sh
cd studio && npm ci && cd desktop && npm ci
npm run package        # düzenleyici, Gyroflow'un wasm'ı ve FFmpeg, ardından dist/mac-arm64 içinde uygulama
```

`studio/` içinde `npm run check:quick` hızlı denetimleri, `npm run verify` ise tam seti çalıştırır (Google Chrome ve
FFmpeg gerekir).

## Depo yapısı

| Yol | Ne olduğu |
| --- | --- |
| `studio/` | Düzenleyici, [FreeCut](https://github.com/walterlow/freecut)'ın (MIT) bir fork'u. DroneClean'in kendi kodu `studio/src/studio/` içindedir. |
| `studio/desktop/` | Electron uygulaması, FFmpeg derlemesi ve sürüm betiği. |
| `studio/mcp/` | Bir ajanın başlattığı MCP başlatıcısı. |
| `studio/web/` | Web düzenleyicisinin statik sunucusu. |
| `gyroflow/` | [Gyroflow](https://github.com/gyroflow/gyroflow)'un (GPL-3.0) bir fork'u; `gyroflow/wasm/` onun motorunu düzenleyici için derler. |

Bu depo sürüm süreci tarafından yayımlanır: her sürüm tek bir commit'tir ve bu sürüm için etiketi `v0.1.10`'dır.

## Katkı ve güvenlik

Hata bildirimleri ve fikirler memnuniyetle karşılanır: [bir issue aç](../../issues/new/choose).
[CONTRIBUTING.md](CONTRIBUTING.md), değişikliklerin bir sürüme nasıl ulaştığını anlatır. Bir güvenlik açığını
[SECURITY.md](SECURITY.md)'de anlatıldığı gibi özel olarak bildir, asla herkese açık bir issue'da değil.

## Lisans ve katkıda bulunanlar

GPL-3.0-or-later ([LICENSE](LICENSE)'a bak). DroneClean Studio, FreeCut'ı (MIT) ve Gyroflow'u (GPL-3.0) içerir;
masaüstü uygulaması, resmî kaynağından `studio/desktop/scripts/build-ffmpeg.sh` ile derlenmiş FFmpeg'i (LGPL-2.1)
içerir. Ekran görüntüsü, [Pexels Lisansı](https://www.pexels.com/license/) kapsamındaki Pexels 39579103 numaralı
videoyu gösterir. Demo ve önce-sonra karşılaştırması yazarın kendi DJI Avata 2 görüntülerini gösterir; bunlar
droneclean.app üzerinden sunulur ve bu deponun ya da lisansının parçası değildir.
