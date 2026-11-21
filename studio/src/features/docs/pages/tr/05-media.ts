import type { DocPageContent } from '../../docs-content'

const page = {
  order: 5,
  slug: 'media',
  title: 'Medya Kitaplığı',
  description:
    'Medya içe aktarın, dosyaları inceleyin; proxy, transkript, altyazı ve YZ sahne verileri oluşturun.',
  category: 'Core Editing',
  related: ['source-monitor', 'timeline', 'scene-browser', 'export'],
  sections: [
    {
      title: 'Medya içe aktarma',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Medya** sekmesini açın ve dosyaları seçmek için **İçe aktar** düğmesini kullanın; dosyaları doğrudan kitaplığa da sürükleyebilirsiniz.',
            "DroneClean Studio; video, ses, görüntü, GIF, SVG, Lottie animasyonları (`.json` ve `.lottie`) ve üretilmiş varlıkları işler. GIF'ler görüntü öğesi olarak içe aktarılır.",
            "Bir medya dosyasına doğrudan bağlantı için **URL'den medya içe aktar** seçeneğini kullanın. URL, dosyayı gömen bir sayfaya değil, dosyanın kendisine işaret etmelidir.",
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: "Apple ProRes görüntüleri, diğer klipler gibi içe aktarılır, önizlenir ve küçük resimleri oluşturulur; tarayıcıların kendi başına çözemediği biçimler de buna dahildir. Dışa aktarırken ProRes klipler seçtiğiniz çıkış codec'ine yeniden kodlanır; ProRes çıkış biçimi yoktur.",
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Klasör içe aktarma henüz desteklenmiyor; medya dosyalarını doğrudan bırakın. Nelerin çözülebileceği tarayıcınıza bağlıdır; bir dosya içe aktarılmıyorsa başka bir biçim deneyin veya önce dönüştürün.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Log görüntüler (S-Log3 ve benzerleri) tasarım gereği düz ve soluk görünür; kayıt yöntemi böyledir. Normal haline getirmek için bir LUT ekleyin veya renk düzenleme uygulayın; dosyada bir sorun yoktur.',
        },
      ],
    },
    {
      title: 'Bir klibi inceleme',
      blocks: [
        {
          kind: 'list',
          items: [
            'Codec, boyutlar, süre, kare hızı, dosya boyutu, tür ve transkript durumunu görmek için **Medya bilgisi** bölümünü açın.',
            'Bir kaynağı kurguya almadan önce önizlemek için medya kartına çift tıklayın ya da **Kaynak monitöründe aç** seçeneğini kullanın.',
            'Medya kartları Dosya, Proxy, Transkript, Gömülü altyazılar ve YZ eylemleri için menüler sunar.',
            'Kitaplık büyüdüğünde varlıkları türe göre sıralayın, süzün ve gruplayın.',
          ],
        },
      ],
    },
    {
      title: 'Destek verisi oluşturma',
      blocks: [
        {
          kind: 'table',
          headers: ['Eylem', 'Size ne sağlar'],
          rows: [
            [
              'Proxy oluştur',
              'Daha akıcı kurgu için ağır bir videonun hafif sürümü; dışa aktarma yine orijinali kullanır.',
            ],
            [
              'Transkript oluştur',
              'Arayabileceğiniz ve altyazıya dönüştürebileceğiniz, düzenlenebilir konuşma metni.',
            ],
            [
              'Gömülü altyazıları çıkar',
              'Dosyadan çekilen, zaman çizelgesine eklenmeye hazır altyazı parçaları.',
            ],
            [
              'YZ ile analiz et',
              "Klipleri Sahne Tarayıcı'da aranabilir hale getiren yerel sahne algılama ve altyazılama.",
            ],
          ],
        },
      ],
    },
    {
      title: 'Bileşik klipler',
      blocks: [
        {
          kind: 'list',
          items: [
            'Zaman çizelgesinin bir bölümünü, tek bir yeniden kullanılabilir medya öğesi gibi davranan bir **bileşik klipte** gruplayın.',
            'Bileşik klipler medya kitaplığında görünür ve diğer varlıklar gibi yeniden yerleştirilebilir.',
            'Bir bileşik klibe sağ tıklayın ve bağımsız bir **sekans** olarak düzenlemek için **Sekme olarak aç** seçeneğini seçin.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Bileşik klipler iç içe geçebilir (biri diğerini içerebilir); yeter ki zincir kendi üzerine dönmesin.',
        },
      ],
    },
    {
      title: 'Lottie animasyonları',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Lottie dosyalarını (ham `.json` veya paketlenmiş `.lottie` arşivleri) önizlemede ve dışa aktarmada kare doğruluğuyla işlenen zaman çizelgesi öğeleri olarak içe aktarın. Düzenleme denetimlerini görmek için bir Lottie klibini seçin; denetimler özellikler panelinin **Lottie** bölümündedir.',
        },
        {
          kind: 'list',
          items: [
            'Oynatmayı **Hız**, **Ters**, **Döngü** ve **Ping-pong** ile denetleyin.',
            'Animasyonun yalnızca bir bölümünü oynatmak için bir **Başlangıç karesi** / **Bitiş karesi** aralığı belirleyin ya da bölümü adlandırılmış bir **İşaretçiye** atlatmak için onu seçin.',
            'Animasyonu yeniden renklendirin: yazarın adlandırdığı **Renkler** önce gösterilir, kalan şekiller açılır bir bölümün altında durur; paylaşılan bir renk, onu kullanan her şekli düzenler ve **Tümünü sıfırla** orijinalleri geri getirir.',
            'Şablon **Metin** katmanlarını yerinde düzenleyin ve **Özellikler** altındaki açık skaler ve vektör değer yuvalarını ayarlayın.',
            'Birden fazla animasyon içeren `.lottie` arşivlerinde, aralarında **Animasyon** seçicisiyle geçiş yapın; dosya temalarla geliyorsa paletleri **Tema** seçicisiyle değiştirin.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Renk, metin, yuva ve aralık düzenlemeleri, sürüklerken veya yazarken tuvalde canlı önizlenir ve tek bir geri alma adımı olarak uygulanır. Animasyon, tema, işaretçi, aralık ve şablon düzenlemesi aynı anda yalnızca seçili tek bir Lottie klibine uygulanır.',
        },
      ],
    },
    {
      title: 'Eksik medyayı düzeltme',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: 'Eksik medya, bağlı bir dosya taşındığında, yeniden adlandırıldığında, silindiğinde veya yenilenmiş izne ihtiyaç duyduğunda görünür. Bağlantıyı geri kazanmak için **Erişim ver**, **Bul**, **Klasörü bul** veya **Başka klasöre göz at** seçeneğini kullanın. **Çevrimdışı çalış** seçeneğini yalnızca sonra yeniden bağlamak istiyorsanız kullanın.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
