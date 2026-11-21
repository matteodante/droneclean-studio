import type { DocPageContent } from '../../docs-content'

const page = {
  order: 20,
  slug: 'keyboard-shortcuts',
  title: 'Klavye Kısayolları',
  description:
    'Gruplara göre varsayılan kısayollar ve bunları nasıl arayacağınız, yeniden atayacağınız ve sıfırlayacağınız.',
  category: 'Reference',
  sections: [
    {
      title: 'Oynatma',
      blocks: [
        {
          kind: 'table',
          headers: ['Eylem', 'Kısayol'],
          rows: [
            ['Oynat / Duraklat', '`Space`'],
            ['Önceki / Sonraki kare', '`Left` / `Right`'],
            ['Önceki / Sonraki yakalama noktası', '`Up` / `Down`'],
            ['Başa / sona git', '`Home` / `End`'],
          ],
        },
      ],
    },
    {
      title: 'Kurgu',
      blocks: [
        {
          kind: 'table',
          headers: ['Eylem', 'Kısayol'],
          rows: [
            ['Oynatma başlığında böl', '`Alt+C`'],
            ['İmleçte böl', '`Shift+C`'],
            ['Birleştir', '`Shift+J`'],
            ['Sil / Ripple sil', '`Delete` / `Ctrl+Delete`'],
            ['Donmuş kare ekle', '`Shift+F`'],
            ['Klipleri bağla / bağlantıyı kaldır', '`Ctrl+Alt+L` / `Alt+Shift+L`'],
            ['Bağlı seçimi aç/kapat', '`Shift+L`'],
            ['1 px / 10 px kaydır', '`Shift+Arrow` / `Ctrl+Shift+Arrow`'],
          ],
        },
      ],
    },
    {
      title: 'Araçlar',
      blocks: [
        {
          kind: 'table',
          headers: ['Araç', 'Kısayol'],
          rows: [
            ['Seçim', '`V`'],
            ['Kırpma düzenleme', '`T`'],
            ['Kesici', '`C`'],
            ['Hız uzatma', '`R`'],
            ['Slip', '`Y`'],
            ['Slide', '`U`'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Ripple ve rolling, **Kırpma düzenleme** aracının kırpma davranışlarıdır; kendi kısayolları olan ayrı araçlar değildir.',
        },
      ],
    },
    {
      title: 'Geçmiş, görünüm ve pano',
      blocks: [
        {
          kind: 'table',
          headers: ['Eylem', 'Kısayol'],
          rows: [
            ['Geri al / Yinele', '`Ctrl+Z` / `Ctrl+Shift+Z`'],
            ['Kopyala / Kes / Yapıştır', '`Ctrl+C` / `Ctrl+X` / `Ctrl+V`'],
            ['Yakalamayı / tuval yakalamayı aç/kapat', '`S` / `Shift+S`'],
            ['Yakınlaştır / uzaklaştır', '`Ctrl+=` / `Ctrl+-`'],
            ['Sığdır / %100', '`\\` / `Shift+\\`'],
            ['Kurgu / Renk / Motion çalışma alanı', '`Alt+1` / `Alt+2` / `Alt+3`'],
          ],
        },
      ],
    },
    {
      title: 'İşaretçiler ve anahtar kareler',
      blocks: [
        {
          kind: 'table',
          headers: ['Eylem', 'Kısayol'],
          rows: [
            ['İşaretçi ekle / kaldır', '`M` / `Shift+M`'],
            ['Önceki / Sonraki işaretçi', '`[` / `]`'],
            ['Anahtar kareleri temizle', '`Shift+A`'],
            ['Seçili Kurgu katmanına anahtar kare ekle', '`K`'],
            ['Anahtar kare grafiği / sayfası / bölünmüş görünüm', '`1` / `2` / `3`'],
            ['Önceki / Sonraki özellik anahtar karesi', '`Alt+[` / `Alt+]`'],
            ['Etkin özellik için otomatik anahtarı aç/kapat', '`A`'],
            ['Seçili anahtar kareleri sığdır', '`F`'],
          ],
        },
      ],
    },
    {
      title: 'Kaynak monitörü ve proje',
      blocks: [
        {
          kind: 'table',
          headers: ['Eylem', 'Kısayol'],
          rows: [
            ['Giriş / Çıkış işaretle', '`I` / `O`'],
            ['Giriş/Çıkışı temizle', '`Alt+X`'],
            ['Önizlemeyi işle (girişten çıkışa veya tüm zaman çizelgesi)', '`Enter`'],
            ['Araya ekleme / üzerine yazma düzenlemesi', '`,` / `.`'],
            ['Kaydet', '`Ctrl+S`'],
            ['Dışa aktar', '`Ctrl+Shift+E`'],
            ["Sahne Tarayıcı'yı aç", '`Ctrl+Shift+F`'],
          ],
        },
      ],
    },
    {
      title: 'Kısayolları özelleştirme',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Yukarıdaki her atama, ürünle gelen bir varsayılandır. Herhangi bir komutu tercih ettiğiniz tuşlara yeniden atamak için editör araç çubuğundaki **Klavye Kısayolları** düğmesinden (klavye simgesi) yeniden tasarlanmış kısayol düzenleyicisini açın.',
        },
        {
          kind: 'steps',
          items: [
            'Komutları ada göre arayın ya da **Özel**, **Çakışmalar** veya **Atanmamış** gruplarına süzün.',
            'Bir komut seçin ve **Kaydet** düğmesine basın, ardından değiştirici tuşları basılı tutup son tuşa basın.',
            'Kombinasyon zaten kullanımdaysa düzenleyici çakışmayı işaretler; yeniden atamak için **Üzerine yaz** seçeneğini seçin ya da başka tuşlar seçin.',
            'Bir atamayı temizlemek için **Bağı kaldır** seçeneğini kullanın ya da birincil atamanın yanına alternatif bir atama ekleyin.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Tek bir komutu geri yüklemek için **Sıfırla**, her kısayolu varsayılanına döndürmek için **Tümünü Sıfırla** seçeneğini kullanın. Atamalarınızı bir ön ayar dosyasına **Dışa Aktar** ve başka bir makinede **İçe Aktar** da yapabilirsiniz.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
