import type { DocPageContent } from '../../docs-content'

const page = {
  order: 15.75,
  slug: 'motion',
  title: 'Motion çalışma alanını kullanma',
  description:
    'Motion çalışma alanında katmanlı 2D kompozisyonlar oluşturun, zamanlayın, canlandırın, üst öğeye bağlayın ve yeniden kullanın.',
  category: 'Creative Tools',
  related: ['motion-library', 'keyframes', 'shapes-masks', 'concepts'],
  sections: [
    {
      title: 'Bir Motion kompozisyonu açma veya oluşturma',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Motion; medya kitaplığını, kompozisyon önizlemesini, katman zaman çizelgesini, özellikleri, anahtar kareleri, grafiği ve Hareket kitaplığını tek bir çalışma alanında tutar.',
        },
        {
          kind: 'steps',
          items: [
            'Çalışma alanı değiştiricide **Motion** seçeneğini seçin ya da `Alt+3` tuşlarına basın.',
            'Kompozisyon menüsünden var olan bir kompozisyonu seçin ya da **Yeni kompozisyon** seçeneğini seçin.',
            "Sekans kliplerini yükseltmek için bunları Kurgu'da seçin, **Animasyon** bölümünü açın ve **Motion Klibi Oluştur** seçeneğini seçin.",
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: "Bir Motion Klibi oluşturmak, seçili klipleri ve animasyonlarını yeni kompozisyonun içinde korur. Yeni sarmalayıcı, Kurgu'da sıradan bir klip olarak kalır.",
        },
      ],
    },
    {
      title: 'Kompozisyona katman ekleme',
      blocks: [
        {
          kind: 'list',
          items: [
            'Medya kitaplığından video, ses, görüntü, metin, şekil, Lottie dosyası veya başka bir kompozisyon sürükleyin.',
            '**Metin**, **Düz Renk**, **Degrade**, **Şekil** veya **Boş nesne** katmanları oluşturmak için **Öğe ekle** seçeneğini seçin.',
            'Düz Renk ve Degrade, yeniden boyutlandırabileceğiniz, biçimlendirebileceğiniz, maskeleyebileceğiniz ve canlandırabileceğiniz tam kare şekil katmanları oluşturur.',
            'DroneClean Studio, dolaylı döngüsel iç içe yerleştirme dahil, bir kompozisyonun kendini içermesini engeller.',
          ],
        },
      ],
    },
    {
      title: 'Süreyi ve etkin aralığı ayarlama',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Yazılan süre kompozisyonu tanımlar. Cetveldeki Giriş ve Çıkış tutamaçları, o sürenin içindeki etkin işleme aralığını tanımlar.',
        },
        {
          kind: 'steps',
          items: [
            'Etkin aralığı işaretlemek için Motion cetvelinin üstündeki **Giriş** ve **Çıkış** tutamaçlarını sürükleyin.',
            'Yazılan kompozisyonu o aralığa kısaltmak için **Kompozisyonu etkin bölgeye kırp** seçeneğini seçin.',
            'Süresini değiştirmeden yazılan kompozisyonu çerçevelemek için **Sığdır** seçeneğini seçin.',
            "Özellikler'de **Kompozisyon Süresi** değerini düzenleyin ve kare ile saniye arasında geçiş yapmak için birimini seçin.",
            'Süre denetiminin altındaki eşleşen **Zaman Kodu** değerini okuyun.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Kırpma, Giriş ve Çıkış denetimlerini kullanılabilir tutar ve yeni aralığı sığdırır. Yazılan sürenin ötesine uzanan katmanlar, soluk taşma bölgesinde görünür kalır.',
        },
      ],
    },
    {
      title: 'Katmanları düzenleme ve zamanlama',
      blocks: [
        {
          kind: 'list',
          items: [
            'Bir katman aralığını zamanda taşımak için sürükleyin. Seçili katmanlar tek bir geri alma adımında birlikte taşınır.',
            'Her katmanın **Giriş** ve **Çıkış** alanlarını düzenleyin ya da kırpmak için aralık kenarlarını sürükleyin.',
            "Görünürlüğü, kilidi, solo'yu, karışım modunu ve yığın sırasını değiştirmek için katman denetimlerini kullanın.",
            'Bir katmanı veya grubu yeniden sıralamak için üç noktalı tutamacı sürükleyin. Alt katmanlar mevcut gruplarının içinde kalır.',
            "İki veya daha fazla katman seçin ve **Katman grubu** seçeneğini seçin. Grup görünürlüğü, kilidi, solo'su, zamanlaması ve yeniden sıralaması alt öğelerine uygulanır.",
            'Bir katmanı veya grubu yeniden adlandırmak, gruplamak, grubunu çözmek, çoğaltmak, kopyalamak, yapıştırmak veya silmek için sağ tıklayın.',
          ],
        },
      ],
    },
    {
      title: 'Özellikleri ve yol köşelerini canlandırma',
      blocks: [
        {
          kind: 'list',
          items: [
            'İç içe özellik gruplarını, değer denetimlerini, otomatik anahtarı, gezinmeyi ve anahtar kare elmaslarını görmek için bir katmanı genişletin.',
            'Yalnızca anahtar içeren satırlara ihtiyacınız olduğunda özellik süzgecini **Animasyonlu** olarak ayarlayın.',
            'Ortak oynatma başlığında bir anahtar eklemek veya kaldırmak için bir özellik elması seçin.',
            'Bölüm yavaşlama eğrisini düzenlemek için iki komşu anahtar seçin.',
            'Dope sheet şeridini satır içi bir değer grafiğiyle değiştirmek için bir özellik eğrisi simgesi seçin.',
            "X ve Y'yi birbirinden bağımsız düzenlemek için Konum grubu menüsünü açın ve **Separate Position dimensions** seçeneğini seçin.",
          ],
        },
        {
          kind: 'paragraph',
          text: "Yol şekilleri Motion'da köşe şeritleri sunar. Önizlemede yol noktalarını seçin, ardından özellik satırlarının üstünde **Selected vertices** ile **All vertices** arasında geçiş yapın.",
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Yol Geometrisi anahtar kareler içerdiğinde ilk yol köşesini ekleyemez, kaldıramaz, yeniden sıralayamaz veya değiştiremezsiniz. Yol topolojisini değiştirmeden önce bu anahtarları kaldırın.',
        },
      ],
    },
    {
      title: 'Katmanları Boş nesneyle üst öğeye bağlama',
      blocks: [
        {
          kind: 'steps',
          items: [
            '**Öğe ekle › Boş nesne** seçeneğini seçin. Boş nesne dönüşümleri denetler ama işlenmez.',
            "**Üst öğe** menüsünden bir üst öğe seçin ya da Üst öğe pick whip'ini başka bir katmanın üzerine sürükleyin.",
            'Alt katmanın tuval duruşunu korumak için normal şekilde bırakın.',
            'Alt katmanın konumunu üst öğeye yapıştırmak için bırakırken **Shift** tuşunu basılı tutun.',
            'Alt katmanın yazılan yerel duruşunu kullanmak için bırakırken **Alt/Option** tuşunu basılı tutun.',
            "Alt katmanı mevcut duruşunu koruyarak ayırmak için alt katmanın pick whip'ine Ctrl veya Command ile tıklayın.",
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Sürüklerken geçerli üst öğe hedefleri vurgulanır. Motion, kendini üst öğe yapmayı, alt öğe hedeflerini ve döngü oluşturacak bağlantıları reddeder.',
        },
      ],
    },
    {
      title: 'Özellikleri bağlama veya ifade yazma',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Üst öğeye bağlama bir katman hiyerarşisi oluşturur. Bir **Özellik bağlantısı**, bu hiyerarşiyi değiştirmeden bir özelliğin diğerini izlemesini sağlar.',
        },
        {
          kind: 'list',
          items: [
            "Bir özellik pick whip'ini Motion'daki, dope sheet'teki veya grafikteki uyumlu bir satıra sürükleyin.",
            'Skaler değerleri skaler değerlere bağlayın. Konum, Ölçek ve Bağlantı noktası, tam iki boyutlu değerler olarak bağlanır.',
            'Özelliğin anahtar karelerini silmeden korumalı bir ifade eklemek için küme parantezi düğmesini seçin.',
            'Metin imlecinin bulunduğu yere bir `prop("layer-id", "property")` referansı eklemek için ifade pick whip\'ini kullanın.',
            '`value`, `preValue`, `frame`, `time`, skaler veya `[x, y]` değerlerini, aritmetiği ve desteklenen matematik işlevlerini kullanın.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio önce anahtar kareleri, sonra Özellik bağlantısını, sonra ifadeyi değerlendirir. Önizleme ve dışa aktarma aynı sırayı kullanır.',
        },
      ],
    },
    {
      title: 'Yeniden kullanılan kompozisyonlar için denetimleri açma',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Kaynak kompozisyonun içinde **Published controls** bölümünü açın.',
            'Bir editörün yerleştirilen örneklerde değiştirmesi gereken metni veya renkleri yayımlayın.',
            'Kompozisyonu sıradan bir sekansa yerleştirin ve o örneği seçin.',
            "Kaynak kompozisyonu değiştirmeden, yayımlanan değerlerini Özellikler'de düzenleyin.",
            'Bir geçersiz kılmayı sıfırlayın ya da kaynak değerlerini geri yüklemek için **Reset all overrides** seçeneğini kullanın.',
          ],
        },
      ],
    },
    {
      title: "Kompozisyonu Kurgu'da kullanma",
      blocks: [
        {
          kind: 'paragraph',
          text: 'Bir Motion kompozisyonu, yeniden kullanılabilir bir kompozisyon varlığı olarak kalır. Onu bir sekansa yerleştirin, ardından örneği başka herhangi bir klip gibi taşıyın, kırpın, canlandırın veya ona efekt uygulayın.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: "Dahili katman animasyonu ile tüm klip animasyonu bağımsız kalır. Bir başlık içeride canlanırken, yerleştirilen örneği Kurgu'da hareket edebilir veya solabilir.",
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
