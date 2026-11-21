import type { DocPageContent } from '../../docs-content'

const page = {
  order: 14,
  slug: 'transitions',
  title: 'Geçişler',
  description:
    'Bir kesime geçiş uygulayın; stilini, süresini, yerleşimini, yavaşlama eğrisini ve yönünü ayarlayın.',
  category: 'Creative Tools',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: 'Geçiş uygulama',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Medya kenar çubuğunda **Geçişler** sekmesini açın.',
            'Bir geçiş kartını iki bitişik klip arasındaki bir kesime sürükleyin ya da geçerli bir kesim seçip bir karta tıklayın.',
            "Özellikler'deki **Geçiş** bölümünü açmak için zaman çizelgesinde geçişi seçin.",
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'İki klip uç uca durduğunda ve üst üste binmeye yetecek kadar yedek kaynak karesi olduğunda bir kesim geçerlidir. Mevcut bir geçişin üzerine uygulamak onu yerinde değiştirir.',
        },
      ],
    },
    {
      title: 'Bir görünüm seçme',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Kartlar kategoriye göre gruplanır: **Temel**, **Çözülme**, **Hareket**, **Silme**, **Kaydırma**, **Çevirme**, **Maske**, **İris**, **Şekil**, **Işık** ve **Kromatik**.',
        },
        {
          kind: 'list',
          items: [
            "Çözülme stilleri, sade bir Cross Dissolve'dan Additive, Blur ve Dip To Color varyantlarına kadar uzanır.",
            'Hareket ve özel stiller arasında Flip, Light Leak, Pixelate, Chromatic, Radial Blur, Glitch ve Sparkles bulunur.',
            'Wipe, Slide ve Flip gibi yönlü stiller, her yön için bir tane olmak üzere birkaç kart olarak görünür.',
          ],
        },
      ],
    },
    {
      title: 'Bir geçişi ayarlama',
      blocks: [
        {
          kind: 'table',
          headers: ['Denetim', 'Ne yapar'],
          rows: [
            ['Ön ayar', 'Kesimi yeniden yapmadan geçiş stilini değiştirir.'],
            ['Süre', 'Geçişin ne kadar süreceğini belirler; sıfırlama 1 saniyeye döndürür.'],
            [
              'Yerleşim',
              'Kesimin ortasına alır ya da geçişi kesimden önceye veya sonraya kaydırır.',
            ],
            ['Yavaşlama', 'Doğrusal, Giriş, Çıkış veya Giriş ve Çıkış.'],
            ['Yön', 'Yönlü stiller için Sol, Sağ, Üst veya Alt.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Bir geçişin kenarını doğrudan zaman çizelgesinde sürükleyerek de yeniden boyutlandırabilirsiniz.',
        },
      ],
    },
    {
      title: 'Bir geçiş uygulanmazsa',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'İki klip arasında gerçek bir kesime ve ilgili tarafta yeterli **kaynak payına** ihtiyacınız var. Bir yerleşim engelleniyorsa başka bir yerleşim seçin ya da daha az kırpın. Geçerli bir kesime sürüklemek, tıklayarak uygulama mümkün olmasa bile her zaman çalışır.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
