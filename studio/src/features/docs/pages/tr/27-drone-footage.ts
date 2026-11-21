import type { DocPageContent } from '../../docs-content'

// DroneClean Studio's own tools for drone and FPV footage (19 Nov 2026; the tools of 0.1.3-0.1.4 added 20 Nov 2026):
// what FreeCut's pages do not cover.
const page = {
  order: 27,
  slug: 'drone-footage',
  title: 'Drone görüntüsü: sabitle, renk düzenle, hızlandır, paylaş',
  description:
    'Jiroskop sabitleme ve kadraj, D-Log M profili, görünümler ve gökyüzü, yavaşlama eğrili hız rampaları, hareket bulanıklığı ve akıcı ağır çekim, vuruş işaretçileri, tek tıkla yumuşak kurgu, Instagram Reels, TikTok ve YouTube Shorts için dışa aktarma ve ajan erişimi.',
  category: 'Creative Tools',
  related: ['effects-color', 'keyframes', 'export', 'properties'],
  sections: [
    {
      title: 'Jiroskop verisinden sabitleme',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DJI ve GoPro dosyaları kameranın hareketini taşır. Bir klip seçin ve Özellikler › Video › Sabitleme altında **Bu klibi sabitle** seçeneğini açın: klip bu veriden sabitlenir, analiz geçişi gerekmez; **Yumuşatma** ve **Ufuk kilidi** ayarları sabitlemeyi inceltir.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Sabitlenmiş bir klip projenin biçiminde çizilir. 9:16 bir projedeki 4:3 bir Avata klibi dikey kareyi kendiliğinden doldurur; onu ölçeklemeniz gerekmez.',
        },
        {
          kind: 'paragraph',
          text: '**Kadraj** (Sabitleme altındaki iki kaydırıcı), sabitlemenin bıraktığı boşluk elverdiği ölçüde, sabitlenmiş pencereyi görüntünün içinde yana veya yukarı aşağı kaydırır; böylece dikey bir kurgu konusunu görüş alanında tutar. Her kaydırıcının yanındaki elmas ona anahtar ekler; böylece kadraj, çekim boyunca konuyu izleyebilir.',
        },
      ],
    },
    {
      title: 'Renk: profil, görünüm, renk düzenleme',
      blocks: [
        {
          kind: 'steps',
          items: [
            "Log kliplerin **Renk profili** ayarını yapın (Avata 2 için D-Log M, D-Log): düz görüntü, başka bir şey olmadan önce Rec.709'a dönüşür. DJI dosyaları hangi profille çekildiklerini söylemez; bu yüzden bir projenin ilk DJI içe aktarması bir kez sorar; **Evet, D-Log M** onu o kliplere uygular. Profil, Avata 2 görüntüleriyle ayarlandı. DJI, Mini 4 Pro ve Air 3 için de bir D-Log M LUT yayımlıyor ve panel bu droneları tanıyor; ancak onların renkleri burada denetlenmedi ve panel bunu belirtiyor.",
            'Bir **görünüm** seçin (çalışma alanının görünümler kitaplığından bir `.cube` dosyası; **Görünümleri yönet… › .cube ekle** bir tane ekler) ve **Yoğunluk** ayarını yapın.',
            '**Efektler** bölümünde tamamlayın: kontrast, parlak alanlar ve orta ayrıntı için Color Wheels; beyaz kapalı bir gökyüzüne kademeli bir mavi veren **Sky** (ufuk, açı, yumuşaklık ve onu parlak, soluk piksellerde tutan bir koruma); aynısını elle yapan bir Secondary Qualifier ve bir Power Window; Glow, Vignette ve Sharpen görüntüyü bitirir.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Buz ve kar da beyazdır: buzlu çekimlerde niteleyiciyi hafif tutun ve gökyüzünü kademeli pencerenin renklendirmesine bırakın.',
        },
      ],
    },
    {
      title: 'Hız, hareket bulanıklığı ve akıcı ağır çekim',
      blocks: [
        {
          kind: 'table',
          headers: ['Denetim', 'Ne yapar'],
          rows: [
            ['Hız', 'Tek bir sabit hız; klip kaynak aralığını korur ve uzunluğu onu izler.'],
            [
              'Eğri…',
              'Anahtarlı bir hız eğrisi: içeri rampa, dışarı rampa veya ikisi birden; her bölüm Doğrusal, Yumuşak, Yavaş başla veya Yavaş bitir. Panel, klibin en yavaş noktasında gerçekten sahip olduğu saniyedeki kareyi gösterir.',
            ],
            [
              'Yumuşak rampa + yakınlaştırma',
              'Drone reel tarifi tek tıkla, hız panelinde: hızlı, ortada yaklaşık 0,45x, yine hızlı; yumuşak bölümler, akıcı ağır çekim, hareket bulanıklığı ve yumuşatılmış bir yakınlaştırma.',
            ],
            [
              'Hareket bulanıklığı',
              '1x üzerinde, her çıkış karesinin kapsadığı kaynak karelerini 90° ile 360° arasında bir deklanşörle harmanlar.',
            ],
            [
              'Akıcı ağır çekim',
              '1x altında ya da 60 fps bir projedeki 30 fps bir dosya için, bir kareyi iki kez göstermek yerine aradaki kareleri üretir: Kare harmanlama iki kaynak karesini karıştırır, Optik akış kareyi aralarındaki hareketten oluşturur (daha keskin, çift görüntü olmadan).',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: "Yalnızca projeden daha yüksek kare hızında çekilmiş görüntüyü yavaşlatın. 60 fps bir projedeki 30 fps bir dosya, ihtiyaç duyduğu karelerin zaten yarısına sahiptir: onu 1x veya daha hızlı tutun ve 60 fps görüntüyü 0,5x'ten fazla yavaşlatmayın.",
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Her vuruşta değil, şarkının güçlü vuruşlarında kesin: şarkıya sağ tıklayın ve **Vuruşları işaretle** seçeneğini seçin (her güçlü bas vuruşuna bir işaretçi) ya da bunları `M` ile kendiniz işaretleyin, sonra her klibin bir işaretçiden diğerine kadar oynamasına izin verin.',
        },
      ],
    },
    {
      title: 'Tek tıkla yumuşak kurgu',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Video kliplerini ve bir şarkıyı zaman çizelgesine koy, ardından **Yumuşak kurgu…** düğmesine tıkla (zaman çizelgesi araç çubuğundaki ışıltılı düğme). Editör şarkının vuruşlarını bulur, video kliplerini ilk vuruştan başlayarak arka arkaya dizer, her birini seçtiğin ölçü sayısına göre keser ve her birine yumuşak kurgu görünümünü verir: optik akışlı ağır çekimle hızlı, yavaş, hızlı bir hız rampası, hareket bulanıklığı ve yumuşak bir yakınlaştırma. Drone reel kurgusu tek adımda biter.',
        },
        {
          kind: 'steps',
          items: [
            'Şarkıyı ve klipleri zaman çizelgesine ekle. Hiç ses klibi yoksa pencerede **Önce zaman çizelgesine bir şarkı ekleyin** yazar.',
            '**Yumuşak kurgu…** düğmesine tıkla; birden fazla şarkı varsa şarkıyı, **Çekim uzunluğu** değerini (1, 2 veya 4 ölçü; bir ölçü dört vuruştur) ve **Her kesimde kısa çapraz geçiş** seçeneğini isteyip istemediğini seç.',
            'Pencere kaç klibin değişeceğini söyler. **Uygula** düğmesine tıkla.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Her klip mevcut giriş noktasını korur; bu yüzden çekiminin nereden başlayacağını seçmek için önce klibin başını kırp. Hızlı bölümler görüntüyü oynatıldığından daha hızlı tüketir, bu yüzden bir ölçülük çekim klibin yaklaşık bir buçuk ölçüsünü kullanır. Giriş noktasından sonra yeterli görüntüsü olmayan bir klip atlanır; şarkı bittikten sonra bitecek klipler olduğu gibi kalır ve son çekimin arkasına yerleşir. Sabitlenmiş bir klip sabitlemesini korur. Hiçbir şey silinmez ve **Ctrl/Cmd+Z** tüm kurguyu tek adımda geri alır.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Bir YZ ajanı aynısını tek bir çağrıyla, `studio.clips.smoothEditTimeline({ bars, crossfade })` ile yapabilir ve yine de önce her klibin en iyi bölümünü kendisi seçebilir.',
        },
      ],
    },
    {
      title: "Instagram, TikTok ve Shorts için dışa aktarma",
      blocks: [
        {
          kind: 'paragraph',
          text: "**Instagram Reels** ön ayarı Meta'nın Reel belirtimini izler: projenin kare hızında H.264 MP4, 60 fps'de 20 Mbps veya 30 fps'de 12 Mbps (Meta'nın 25 Mbps üst sınırının altında), 128 kbps AAC ses, dosyanın başında dizin ve düzenleme listesi yok. Dikey (9:16) bir projede kare 1080x1920'dir ve Instagram'ın gösterdiği kare budur; başka bir projede ön ayar projenin şeklini korur (16:9 için 1920x1080) ve asla germez. Instagram her yüklemeyi yeniden kodlar; ona kendi karesini ve boyutunu vermek ikinci bir ölçeklemeyi önler.",
        },
        {
          kind: 'paragraph',
          text: "**TikTok** ve **YouTube Shorts** hazır ayarları, projenin kare hızında (en fazla 60 fps) aynı H.264 MP4 dosyasını üretir: dikey bir projede 1080x1920, başka bir projede projenin kendi şekli. **YouTube Shorts**, YouTube'un yayımladığı 1080p değerlerini kullanır: 60 fps için 12 Mbps veya 30 fps için 8 Mbps, 384 kbps AAC stereo ses ile. TikTok bir bit hızı yayımlamadığından **TikTok**, bizim seçtiğimiz değerleri kullanır: 60 fps için 16 Mbps veya 30 fps için 10 Mbps, 128 kbps AAC ile. İki platform da her yüklemeyi yeniden kodlar. Dikey bir video için 1080x1920'lik dikey bir projeyle başlayın; sabitlemenin kadrajı da drone görüntüsünün hangi bölümünün kalacağını seçer.",
        },
      ],
    },
    {
      title: 'Bir YZ ajanının kurgu yapmasına izin verme',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Masaüstü uygulaması, bilgisayarınızdaki YZ ajanları için yerel bir MCP sunucusu çalıştırır; varsayılan olarak açıktır: **Ayarlar › Ajan erişimi › Yapay zekâ ajanlarına izin ver** onu kapatır veya yeniden açar ve ona yalnızca sizin kullanıcınız erişebilir. Panel, Claude Code için komutu ya da diğer istemciler için yapılandırmayı gösterir. Bir ajan bu durumda bir projeyi oluşturabilir, renk düzenleyebilir ve editörün kullandığı SDK üzerinden dışa aktarabilir; her değişiklik görebileceğiniz bir geri alma adımıdır. Projeyi değiştiren her çağrı onu kaydeder.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
