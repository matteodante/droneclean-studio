import type { DocPageContent } from '../../docs-content'

const page = {
  order: 2,
  slug: 'workspaces',
  title: 'Çalışma Alanları ve Depolama',
  description:
    'Çalışma alanı klasörünün nasıl çalıştığı, dosyaların nerede durduğu, izinler ve önbellek bakımı.',
  category: 'Start',
  related: ['concepts', 'projects', 'troubleshooting'],
  sections: [
    {
      title: 'Çalışma alanı modeli',
      blocks: [
        {
          kind: 'list',
          items: [
            "**Çalışma alanı**, DroneClean Studio'nun okuyup yazdığı, diskteki tek bir klasördür.",
            "DroneClean Studio'nun ürettiği her şey burada durur: proje dosyaları, medya üst verileri, küçük resimler, dalga biçimleri, transkriptler, sahne verileri, YZ varlıkları, önbellekler ve dışa aktarmalar.",
            'İçe aktarılan kaynak medya çalışma alanına kopyalanmaz; DroneClean Studio her dosyanın diskte durduğu yere bir bağlantı kaydeder.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Çalışma alanı gerçek bir klasör olduğu için onu başka herhangi bir dizin gibi yedekleyebilir, eşitleyebilir veya taşıyabilirsiniz.',
        },
      ],
    },
    {
      title: 'Çalışma alanı seçme ve değiştirme',
      blocks: [
        {
          kind: 'list',
          items: [
            'İlk açılışta DroneClean Studio, editör açılmadan önce bir çalışma alanı seçmenizi ister.',
            'Sahibi olduğunuz sıradan bir klasör seçin; örneğin Belgeler içinde bir klasör. Korumalı sistem konumlarından kaçının.',
            'Bilinen çalışma alanlarını eklemek, aralarında geçiş yapmak veya kaldırmak için **Çalışma alanları** denetimini kullanın.',
            "Geçiş yapmak, DroneClean Studio'nun kullandığı klasörü değiştirir; kaynak medyanızı taşımaz.",
          ],
        },
      ],
    },
    {
      title: 'İzinler ve yeniden bağlanma',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Tarayıcılar güvenlik için klasör iznini oturumlar arasında sona erdirebilir.',
        },
        {
          kind: 'list',
          items: [
            'DroneClean Studio **Çalışma alanınızı yeniden bağlayın** iletisini gösterdiğinde **Yeniden bağlan** düğmesini seçin ve aynı klasöre okuma ve yazma erişimi verin.',
            'Erişim reddedilirse klasörü yeniden seçin ve tarayıcı sorduğunda erişime izin verin.',
            'Klasör taşınmış, yeniden adlandırılmış ya da silinmişse bunun yerine başka bir klasör seçin.',
          ],
        },
      ],
    },
    {
      title: 'Eksik medya',
      blocks: [
        {
          kind: 'list',
          items: [
            "Eksik medya, DroneClean Studio'nun bağlı kaynak dosyalardan bir veya birkaçını şu anda okuyamadığı anlamına gelir.",
            'Bir dosyanın yalnızca tarayıcı iznini yenilemesi gerekiyorsa **Erişim ver** seçeneğini kullanın.',
            'Bir dosya ya da klasörü taşındıysa **Bul** veya **Klasörü bul** seçeneğini kullanın.',
            "DroneClean Studio'yu medyanın yeni bir kopyasına yönlendirmek için **Başka klasöre göz at** seçeneğini kullanın.",
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: '**Çevrimdışı çalış** seçeneğini yalnızca dosyaları sonra yeniden bağlamayı planlıyorsanız kullanın; o zamana kadar klipler bozuk referans olarak kalır.',
        },
      ],
    },
    {
      title: 'Projeleri taşıma ve önbellekleri temizleme',
      blocks: [
        {
          kind: 'list',
          items: [
            'Bir projeyi ve medyasını, başka bir çalışma alanının içe aktarabileceği taşınabilir bir pakette toplamak için **Projeyi Dışa Aktar** seçeneğini kullanın.',
            'Proje önbelleği eylemleri; dalga biçimleri, film şeritleri, GIF kareleri ve çözülmüş ses gibi yeniden üretilebilen verileri temizler.',
            "Depolama ayarlarında ayrıca küçük resimleri yeniden oluşturabilir, eksik proxy'leri üretebilir ve proxy'leri silebilirsiniz.",
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Önbellekleri temizlemek kaynak medyanızı asla silmez; proje ihtiyaç duyduğunda DroneClean Studio önizlemeleri yeniden üretir.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
