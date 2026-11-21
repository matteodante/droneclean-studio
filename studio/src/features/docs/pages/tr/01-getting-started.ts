import type { DocPageContent } from '../../docs-content'

const page = {
  order: 1,
  slug: 'getting-started',
  title: 'Başlarken',
  description:
    'DroneClean Studio nedir, tarayıcınızın neye ihtiyacı var ve ilk kurgunuz açılıştan dışa aktarmaya kadar nasıl yapılır.',
  category: 'Start',
  related: ['concepts', 'workspaces', 'export'],
  sections: [
    {
      title: 'DroneClean Studio nedir',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio, tamamen tarayıcınızda çalışan, **local-first** bir video düzenleyicidir. Hesap, yükleme ya da sunucuda render yoktur. Kurgu, efektler, renk, YZ araçları ve dışa aktarma, GPU ve CPU kullanılarak tümüyle sizin bilgisayarınızda çalışır.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Medyanız cihazınızda kalır. DroneClean Studio orijinal dosyalara bağlantı kurar; projeleri, önbellekleri ve dışa aktarmaları sizin seçtiğiniz bir **çalışma alanı klasörüne** yazar. Buluta hiçbir şey gönderilmez.',
        },
      ],
    },
    {
      title: 'Tarayıcınızın ihtiyaçları',
      blocks: [
        {
          kind: 'paragraph',
          text: "DroneClean Studio modern web API'lerine dayanır; bu yüzden desteklenen yol, güncel bir Chromium tarayıcıdır.",
        },
        {
          kind: 'table',
          headers: ['Tarayıcı', 'Durum'],
          rows: [
            ['Chrome / Edge 113+', 'Tam destekleniyor'],
            ['Brave', 'File System Access API bayrağı etkinleştirildikten sonra çalışır'],
            ['Safari / Firefox', 'Tam iş akışı için henüz desteklenmiyor'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio, File System Access API (çalışma alanı klasörleri), WebCodecs (kod çözme ve dışa aktarma), WebGPU (efektler, renk, YZ) ve OPFS (önbellekler) kullanır. Donanım hızlandırmayı açık tutun ve GPU sürücülerinizi güncel tutun.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: "Brave klasör erişimini engelleyebilir. `brave://flags/#file-system-access-api` adresini açın, değeri **Enabled** yapın ve Brave'i yeniden başlatın.",
        },
      ],
    },
    {
      title: 'İlk kurgunuz',
      blocks: [
        {
          kind: 'steps',
          items: [
            "DroneClean Studio'yu desteklenen bir tarayıcıda açın ve istendiğinde okuyup yazabileceğiniz bir **çalışma alanı klasörü** seçin.",
            'Projeler sayfasında **Yeni Proje** düğmesini seçin ve kurgunun çözünürlüğünü ile kare hızını belirleyin.',
            '**Medya** sekmesini açın ve dosya eklemek için **İçe aktar** düğmesini kullanın; medyayı doğrudan kitaplığa da sürükleyebilirsiniz.',
            'Medya panelinden bir klibi zaman çizelgesindeki bir parçaya sürükleyin.',
            'Oynatmak için `Space` tuşuna basın; kare kare ilerlemek için `Left` ve `Right` tuşlarını kullanın.',
            'Çalışırken `Ctrl+S` ile kaydedin; bitmiş videoyu oluşturmak için **Dışa Aktar** seçeneğini kullanın.',
          ],
        },
      ],
    },
    {
      title: 'Kurulumun çalıştığını doğrulayın',
      blocks: [
        {
          kind: 'list',
          items: [
            'Çalışma alanı seçici açılır ve sıradan bir klasörü kabul eder (korumalı bir sistem konumunu kabul etmez).',
            'İçe aktarılan medya, Medya panelinde küçük resimleriyle kartlar olarak görünür.',
            '`Space` tuşuna bastığınızda oynatma zaman çizelgesinden başlar.',
            'Dışa aktarma ekranı açılır ve ön kontrol, engelleyici bir sorun bildirmez.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Adımlardan biri başarısız olursa, uygun belirtiyi bulmak için **Sorun Giderme** sayfasına bakın.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
