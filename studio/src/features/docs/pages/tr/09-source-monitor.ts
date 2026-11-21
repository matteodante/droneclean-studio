import type { DocPageContent } from '../../docs-content'

const page = {
  order: 9,
  slug: 'source-monitor',
  title: 'Kaynak Monitörü İş Akışı',
  description:
    'Bir kaynağı önizleyin, giriş/çıkış aralığı işaretleyin, yama hedeflerini seçin ve zaman çizelgesine ekleyin veya üzerine yazın.',
  category: 'Core Editing',
  related: ['media', 'timeline', 'scene-browser'],
  sections: [
    {
      title: 'Bir kaynak açma',
      blocks: [
        {
          kind: 'list',
          items: [
            'Bir kaynağı yüklemek için bir medya kartına çift tıklayın ya da Medya bilgisinden **Kaynak monitöründe aç** seçeneğini kullanın.',
            'Monitör başlığı kaynak dosya adını gösterir; çıkmak için bir kapatma denetimi vardır.',
            'Kaynak oynatma, zaman çizelgesi önizlemesinden bağımsızdır; böylece zaman çizelgesindeki oynatma başlığını hareket ettirmeden bir kaynakta gezinebilirsiniz.',
            'Zaman kodu ile kare numarası gösterimi arasında geçiş yapmak için zaman kodu göstergesine tıklayın.',
          ],
        },
      ],
    },
    {
      title: 'Giriş/çıkış aralığı işaretleme',
      blocks: [
        {
          kind: 'steps',
          items: [
            'İstediğiniz ilk kareye gidin ve `I` tuşuna basın (**Mark In**).',
            'İstediğiniz son karenin sonraki karesine gidin ve `O` tuşuna basın (**Mark Out**). Çıkış noktası dahil değildir.',
            'Şeritte giriş tutamacını, çıkış tutamacını veya tüm aralığı sürükleyerek ince ayar yapın.',
            'Yalnızca aralığı gözden geçirmek için **Play In to Out** seçeneğini kullanın; aralığı temizleyip tüm kaynağı kullanmak için `Alt+X` tuşlarına basın.',
          ],
        },
      ],
    },
    {
      title: 'Yama hedeflerini seçme',
      blocks: [
        {
          kind: 'list',
          items: [
            '**V** anahtarı video kaynağı yama hedefini açar veya kapatır; **A** anahtarı aynısını ses için yapar.',
            'Her anahtarın bir hedef seçicisi vardır: **Auto**, adıyla belirli bir parça ya da yeni bir parça oluşturmak için **Create on edit**.',
            'Sesli video, V ve A hedef parçalarına bağlı bir video ve ses çifti yerleştirir.',
            'Etkin zaman çizelgesi parçası, eşleşen V ve A hedeflerini önceden doldurur.',
          ],
        },
      ],
    },
    {
      title: 'Ekleme ve üzerine yazma',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Her iki düzenleme de işaretli aralığı zaman çizelgesindeki geçerli oynatma başlığı karesine yerleştirir, ardından oynatma başlığını yeni klibin sonuna ilerletir.',
        },
        {
          kind: 'table',
          headers: ['Düzenleme', 'Tuş', 'Ne yapar'],
          rows: [
            [
              'Araya ekle',
              '`,`',
              'Aralığı yerleştirir ve hedef parçalardaki sonraki tüm malzemeyi sağa iter.',
            ],
            [
              'Üzerine yaz',
              '`.`',
              'Aralığın altındaki zaman çizelgesi malzemesini değiştirir; çevredeki klipler yerinde kalır.',
            ],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Daha kısa bir aralık işaretlemediğiniz sürece görüntüler, düzenlemede varsayılan olarak **üç saniyelik** bir klip olur.',
        },
      ],
    },
    {
      title: 'Bir düzenleme uygulanmazsa',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Önce **V** veya **A** yama hedeflerinden en az birini etkinleştirin. Ses düzenlemek için **A**, sessiz bir videoyu veya görüntüyü düzenlemek için **V** hedefini etkinleştirin. Kilitli bir hedef parça da düzenlemeyi engeller; kilidini açın ve yeniden deneyin.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
