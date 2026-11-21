import type { DocPageContent } from '../../docs-content'

// order 1.5 places this right after Getting Started in the Start group.
const page = {
  order: 1.5,
  slug: 'concepts',
  title: 'DroneClean Studio Nasıl Çalışır',
  description:
    'Zihinsel model: local-first depolama, projeler ve bağlı medya, kareler ve zaman kodu ve GPU işlem hattı.',
  category: 'Start',
  related: ['workspaces', 'getting-started', 'editing-tools'],
  sections: [
    {
      title: 'Tasarım gereği local-first',
      blocks: [
        {
          kind: 'list',
          items: [
            'DroneClean Studio tarayıcınızda çalışır ve her şeyi diskinizdeki bir **çalışma alanı klasöründe** saklar.',
            'Orijinal video ve sesiniz **bağlanır**; kopyalanmaz ya da yüklenmez. DroneClean Studio dosyaların zaten durduğu yeri gösterir.',
            'Projeler, önbellekler, üretilen varlıklar ve dışa aktarmalar çalışma alanına yazılır; böylece onu herhangi bir klasör gibi yedekleyebilir veya taşıyabilirsiniz.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Medya bağlı olduğu için bir kaynak dosyayı taşımak veya yeniden adlandırmak, yeniden bağlayana kadar **Eksik medya** olarak görünür. Bkz. [Çalışma Alanları ve Depolama](workspaces).',
        },
      ],
    },
    {
      title: 'Projeler, parçalar ve klipler',
      blocks: [
        {
          kind: 'list',
          items: [
            'Bir **proje**; bir zaman çizelgesini, ayarlarını (çözünürlük ve kare hızı) ve kullandığınız medyaya referansları tutar.',
            'Zaman çizelgesi **parçaları** üst üste dizer; üstteki parçalar alttakilerin üzerine işlenir.',
            'Zaman çizelgesindeki bir **klip**, bir kaynak dosyaya açılan bir penceredir. Bir klibi kırpmak kaynağın hangi bölümünün oynayacağını değiştirir, dosyayı değiştirmez.',
            'Bir **ayar katmanı**, kendi medyası olmayan bir kliptir; efektlerini ve rengini altındaki her klibe uygular.',
          ],
        },
      ],
    },
    {
      title: 'Sekanslar ve bileşik klipler',
      blocks: [
        {
          kind: 'paragraph',
          text: "DroneClean Studio'nun **projenizin içindeki bir zaman çizelgesi** için tek bir temel yapısı vardır: kompozisyon. Nasıl kullandığınıza bağlı olarak iki biçimde karşınıza çıkar.",
        },
        {
          kind: 'list',
          items: [
            'Bir **Motion kompozisyonu**, **Motion** içinde açılır; burada ortak editör medyanızı, önizlemenizi ve özelliklerinizi yerinde tutarken alt dock bir katman zaman çizelgesine dönüşür.',
            'Bir **sekans**, aynı projedeki bağımsız bir zaman çizelgesidir ve sekme çubuğundaki bir sekmeden açılır. Her sekansın kendi parçaları, klipleri ve düzenleme geçmişi vardır; ana zaman çizelgesinin kendisi de bir sekanstır.',
            'Bir **bileşik klip**, zaman çizelgesinin bir bölümünü alıp tek bir yeniden kullanılabilir medya öğesine katlar. Zaman çizelgesinde tek bir klip gibi davranır (taşıyın, kırpın, efekt ekleyin); içeriği ise kendi zaman çizelgesinde durur.',
            'İkisi, farklı görülen aynı şeydir: içeriğini bir sekans olarak düzenlemek için bir bileşik klibi açın; herhangi bir sekans da başka bir zaman çizelgesine bileşik klip olarak bırakılabilir.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Bir kompozisyon başka kompozisyonlar içerebilir ama kendini asla içeremez. DroneClean Studio döngüsel referansları engeller; böylece bir bileşik klip kendi içeriğinin içine asla yerleştirilemez.',
        },
      ],
    },
    {
      title: 'Kareler ve zaman kodu',
      blocks: [
        {
          kind: 'list',
          items: [
            'Zamanlama **karelerle** ölçülür. Bir klibin bir başlangıç karesi ve proje kare hızında kare cinsinden bir uzunluğu vardır.',
            'Önizleme **zaman kodunu** gösterir; bazı görünümlerde kare numaralarına geçmek için göstergeye tıklayın.',
            'Kaynak medyanın kare hızı projeden farklı olabilir; bu yüzden kurgu yaptığınızda DroneClean Studio kaynak karelerini proje karelerine dönüştürür.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Projeyi oluştururken proje çözünürlüğünü ve kare hızını teslimat hedefinize uygun ayarlayın.',
        },
      ],
    },
    {
      title: 'Her şey sizin makinenizde işlenir',
      blocks: [
        {
          kind: 'list',
          items: [
            "Oynatma, efektler, renk ve YZ araçları yerel olarak GPU'nuz (WebGPU) ve CPU'nuz (WebCodecs) ile çalışır.",
            "**Proxy'ler**, kurguyu akıcı kılan ağır medyanın hafif kopyalarıdır; son dışa aktarma her zaman orijinalleri kullanır.",
            'Bulutta işleme olmadığı için dışa aktarma sırasında sekmeyi açık tutmak önemlidir; işleme doğrudan tarayıcıda gerçekleşir.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
