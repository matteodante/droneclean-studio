import type { DocPageContent } from '../../docs-content'

const page = {
  order: 8,
  slug: 'preview',
  title: 'Önizleme ve Oynatma',
  description:
    'Oynat, kare kare ilerle, monitörü yakınlaştır, tam ekrana geç, kareleri kaydet, proxy oynatmayı kullan, oynatma çözünürlüğünü düşür ve akıcı oynatma için bir aralığı önceden işle.',
  category: 'Core Editing',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: 'Oynatma ve gezinme',
      blocks: [
        {
          kind: 'list',
          items: [
            'Önizleme denetimleriyle ya da `Space` tuşuyla oynatın ve duraklatın.',
            'Kare doğruluğunda kontroller için `Left` ve `Right` tuşlarıyla kare kare ilerleyin.',
            '`Home` ile zaman çizelgesinin başına, `End` ile sonuna atlayın.',
            'Oynatma başlığının tam konumunu doğrulamak için zaman kodu göstergesine bakın.',
          ],
        },
      ],
    },
    {
      title: 'Görünümü çerçeveleme',
      blocks: [
        {
          kind: 'list',
          items: [
            'Ayrıntıyı incelemek için önizleme yakınlaştırmasını ayarlayın; bu, dışa aktarma tuvalini değiştirmez.',
            'Hareketi veya çerçevelemeyi gözden geçirirken **Tam ekran** seçeneğini kullanın; geri dönmek için Tam ekrandan çık seçeneğini kullanın.',
            'Geçerli kareyi bir görüntü dosyasına yazmak için **Kareyi kaydet** seçeneğini kullanın.',
            'Dönüşüm, maske ve düzenleme bindirmeleri, eşleşen bir öğe seçildiğinde monitörde görünür.',
          ],
        },
      ],
    },
    {
      title: 'Oynatma performansı ve ses',
      blocks: [
        {
          kind: 'list',
          items: [
            "Proxy'ler varsa DroneClean Studio, ağır medyanın daha akıcı oynatılması için onları kullanır; dışa aktarmalar yine orijinalleri kullanır.",
            'Monitör ses denetimi yalnızca yerel oynatmayı etkiler.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Dışa aktarmalar proje miksajını kullanır; bu yüzden monitör ses düzeyi, işlenen sesi asla değiştirmez.',
        },
      ],
    },
    {
      title: 'Oynatma çözünürlüğü',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Taşıma çubuğunda proxy anahtarının yanındaki düğme oynatma çözünürlüğünü ayarlar: **Tam**, **1/2** veya **1/4**. Daha düşük çözünürlük, önizlemenin kendisinin işlediği her karede (efektli klipler, sabitleme, hız rampaları, hareket bulanıklığı) daha az piksel çizer; böylece ağır bölümler daha hızlı oynar, görüntü biraz yumuşar. Ayar tüm uygulama için geçerlidir ve bir dışa aktarmayı asla değiştirmez.',
        },
      ],
    },
    {
      title: 'Bir aralığı önceden işleme',
      blocks: [
        {
          kind: 'paragraph',
          text: "Optik akışlı ağır çekim ve hareket bulanıklığı olan sabitlenmiş klipler gerçek zamanlı önizleme için fazla ağır olabilir. Onları After Effects'teki gibi önceden işle; tam kare hızında oynarlar.",
        },
        {
          kind: 'steps',
          items: [
            'Aralığı giriş ve çıkış noktalarıyla (`I` ve `O`) işaretle ya da tüm zaman çizelgesini işlemek için hiçbir şey işaretleme.',
            'Zaman çizelgesi araç çubuğunda, giriş/çıkış düğmelerinin yanındaki **Önizlemeyi işle** menüsünü aç ve **Girişten çıkışa işle** seçeneğini seç ya da `Enter` tuşuna bas.',
            'İlerlemeyi taşıma çubuğunda izle; oradaki X iptal eder ve zaten işlenmiş olanı korur.',
            'Cetvelin alt kenarındaki yeşil çizgi, artık işlenmiş önizlemeden oynayan kareleri gösterir.',
          ],
        },
        {
          kind: 'list',
          items: [
            'Kareler geçerli oynatma çözünürlüğünde işlenir ve projeyi kapatana kadar bellekte tutulur (en fazla 1 GB, 1080p 60 fps için yaklaşık dört buçuk dakika).',
            'Bir kareyi değiştiren her düzenleme (bir klip, efekt, anahtar kare, geçiş, sabitleme, hız, projenin boyutu veya kare hızı, oynatma çözünürlüğü ya da proxy anahtarı) o kareleri hemen yeşil çizgiden çıkarır: önizleme onları yeniden canlı işler, asla eski bir görüntü göstermez.',
            'Yeniden işlemek yalnızca eksik kareleri hesaplar. Aynı menüdeki **İşlenmiş önizlemeyi sil** belleği boşaltır.',
            'Dışa aktarmalar işlenmiş önizlemeyi asla kullanmaz: her zaman projeden işlerler.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Bilgisayar kareleri önizleme boyutunda kodlayamazsa veya bellek sınırına ulaşılırsa bir mesaj bunu bildirir ve önizleme canlı kalır.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
