import type { DocPageContent } from '../../docs-content'

const page = {
  order: 13,
  slug: 'effects-color',
  title: 'Efektler ve Renk',
  description:
    'GPU efektleri ekleyin ve üst üste dizin, çarklar ve eğrilerle renk düzenleyin, kapsamları okuyun, LUT uygulayın ve düzeltmeleri yalıtın.',
  category: 'Creative Tools',
  related: ['keyframes', 'shapes-masks', 'properties'],
  sections: [
    {
      title: 'Efekt ekleme ve yönetme',
      blocks: [
        {
          kind: 'steps',
          items: [
            "Bir klip seçin ve Özellikler'de **Efektler** bölümünü açın.",
            '**Efekt Ekle** düğmesini kullanın, ardından arayın ya da bir kategoriden seçin. **Ön Ayarlar** bölümündeki yerleşik ön ayarları veya kendi kaydettiğiniz ön ayarları da ekleyebilirsiniz.',
            'Yığını **Yukarı taşı** ve **Aşağı taşı** ile yeniden sıralayın; sıra, efektlerin nasıl birleştiğini değiştirir.',
            'Bir efekti kendi panelinden devre dışı bırakın, sıfırlayın veya kaldırın; sayısal parametreler anahtar karelenebilir.',
          ],
        },
      ],
    },
    {
      title: 'Efekt kataloğu',
      blocks: [
        {
          kind: 'table',
          headers: ['Kategori', 'Efektler'],
          rows: [
            [
              'Color',
              'Brightness, Contrast, Exposure, Saturation, Vibrance, Hue Shift, Temperature, Levels, Curves, Color Wheels, Gradient Map, LUT',
            ],
            ['Blur', 'Gaussian, Box, Motion, Radial, Zoom'],
            [
              'Distort',
              'Pixelate, RGB Split, Twirl, Wave, Bulge/Pinch, Kaleidoscope, Mirror, Fluted Glass, Ripple Glass, Glass Mosaic, Blocks, Droste ve daha fazlası',
            ],
            [
              'Stylize',
              'Vignette, Film Grain, Sharpen, Glow, Scanlines, CRT, VHS, Halftone, Dither, ASCII, Ink, Pixel Sort, Block Glitch, Color Glitch',
            ],
            ['Keying', 'Chroma Key (yeşil ve mavi perde kaldırma)'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Tüm efektler GPU üzerinde (WebGPU) işlenir. Son eklenenler arasında **Gradient Map**, **VHS**, **CRT**, **Droste**, **Block Glitch**, **Ripple Glass** ve **Glass Mosaic** bozulmaları, **Ink** ve **Pixel Sort** bulunur.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '**ASCII** kendi karakterlerini işleyebilir: **Karakter Kümesi** ayarını **Özel** yapın, **Özel Karakterler** alanına karakterlerinizi yazın (dizilim en yoğundan en açığa doğrudur) ve bir **Yazı tipi** seçin (Monospace, Courier, Consolas veya Lucida Console). Yerleşik kümeler arasında ASCII Ramp, Dense, Binary ve Symbols bulunur.',
        },
      ],
    },
    {
      title: 'Renk girişleri ve damlalık',
      blocks: [
        {
          kind: 'list',
          items: [
            'Her renk denetimi bir **altılı (hex)** değer kabul eder; doğrudan alana yazın (yazdıkça önizleme güncellenir).',
            'Saydamlığın desteklendiği yerlerde alan 8 haneli hex (`#rrggbbaa`) alır ve seçici bir alfa kaydırıcısı ekler.',
            'Uygulamanın veya önizlemenin herhangi bir yerinden renk örneklemek için **damlalığa** (pipet) tıklayın; bir büyüteç imleci takip eder, böylece tam pikseli yakalayabilirsiniz, sonra uygulamak için tıklayın.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Damlalık, uygulama içi yerleşik bir örnekleyicidir (tarayıcının yerel olanı değil) ve izin istemi gerektirmez. Aynı araç, Renk çalışma alanındaki tekerleri de besler.',
        },
      ],
    },
    {
      title: 'Renk çalışma alanında renk düzenleme',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Renk** çalışma alanına geçin (`Alt+2`) ve bir klip seçin; henüz renk düzenlemesi yokken bile tekerler ve eğriler hazırdır.',
            '**Renk tekerleri** Gölgeleri, Orta tonları, Parlak alanları ve Ofseti ayarlar; beyaz dengesi seçicileri ve otomatik denge de vardır.',
            '**Eğriler** Ana, Kırmızı, Yeşil ve Mavi kanalları düzenler; nokta eklemek için bir eğriye tıklayın, bir noktayı kaldırmak için üzerine çift tıklayın.',
            '**Önce**, **Sonra** ve **Bölünmüş** ile karşılaştırın; bir görünümü klipler arasında **Renk düzenlemeyi kopyala** ve **Renk düzenlemeyi yapıştır** ile kopyalayın.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '**Renk düzenlemeyi atla** düzenlenmemiş görüntüyü önizler ama dışa aktarmaları asla etkilemez.',
        },
      ],
    },
    {
      title: 'Kapsamları okuma',
      blocks: [
        {
          kind: 'table',
          headers: ['Kapsam', 'Gösterdiği'],
          rows: [
            ['Waveform', 'Parlaklık ve renk dağılımı, yukarıdan aşağıya'],
            ['RGB Parade', 'Kırmızı, yeşil ve mavi kanallar yan yana'],
            ['Vectorscope', 'Ton ve doygunluk'],
            ['Histogram', 'Tonların dağılımı'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Kapsamları **Renk kapsamlarını göster** ile açıp kapatın. Waveform ve Histogram ayrıca RGB, tek kanal ve luma (Y) görünümleri sunar.',
        },
      ],
    },
    {
      title: "LUT'lar ve yalıtılmış düzeltmeler",
      blocks: [
        {
          kind: 'list',
          items: [
            '**LUT (.cube)** efektini ekleyin, **.cube LUT içe aktar** seçeneğini seçin, ardından karıştırmak için **Yoğunluk** ayarını yapın.',
            '**Secondary Qualifier**, bir düzeltmeyi ton, doygunluk ve parlaklık aralığına bağlar.',
            '**Power Window**, bir düzeltmeyi yumuşatma ve ters çevirme ile bir elips veya dikdörtgen maskeyle sınırlar.',
            'Altındaki parçalardaki her klibe renk düzenleme veya efekt uygulamak için bir **ayar katmanı** ekleyin.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'LUT içe aktarma, Chromium tabanlı bir tarayıcı gerektirir.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
