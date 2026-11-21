import type { DocPageContent } from '../../docs-content'

const page = {
  order: 2,
  slug: 'workspaces',
  title: '작업 공간과 저장소',
  description: '작업 공간 폴더의 동작 방식, 파일이 저장되는 위치, 권한, 캐시 관리를 설명해요.',
  category: 'Start',
  related: ['concepts', 'projects', 'troubleshooting'],
  sections: [
    {
      title: '작업 공간의 개념',
      blocks: [
        {
          kind: 'list',
          items: [
            '**작업 공간**은 DroneClean Studio가 읽고 쓰는 디스크 위의 폴더 하나예요.',
            'DroneClean Studio가 만드는 모든 것이 이곳에 저장돼요. 프로젝트 파일, 미디어 메타데이터, 썸네일, 파형, 전사 텍스트, 장면 데이터, AI 에셋, 캐시, 내보낸 파일이 모두 해당돼요.',
            '가져온 원본 미디어는 작업 공간으로 복사되지 않아요. DroneClean Studio는 각 파일이 디스크의 원래 위치에 있는 채로 링크만 기록해요.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '작업 공간은 실제 폴더이므로 다른 폴더처럼 백업하거나, 동기화하거나, 옮길 수 있어요.',
        },
      ],
    },
    {
      title: '작업 공간 선택과 전환',
      blocks: [
        {
          kind: 'list',
          items: [
            '처음 실행하면 편집기가 열리기 전에 작업 공간을 고르라는 안내가 나와요.',
            '내가 소유한 일반 폴더를 고르세요. 예를 들면 문서 폴더 안의 폴더가 좋아요. 보호된 시스템 위치는 피하세요.',
            '**작업 공간** 컨트롤로 알려진 작업 공간을 추가하거나, 전환하거나, 제거할 수 있어요.',
            '전환하면 DroneClean Studio가 사용하는 폴더만 바뀌고, 원본 미디어는 이동하지 않아요.',
          ],
        },
      ],
    },
    {
      title: '권한과 다시 연결',
      blocks: [
        {
          kind: 'paragraph',
          text: '브라우저는 보안을 위해 세션 사이에 폴더 권한을 만료시킬 수 있어요.',
        },
        {
          kind: 'list',
          items: [
            'DroneClean Studio에 **작업 공간 다시 연결**이 표시되면 **다시 연결**을 선택하고, 같은 폴더에 읽기와 쓰기 권한을 허용하세요.',
            '접근이 거부되면 폴더를 다시 선택하고, 브라우저가 물어볼 때 접근을 허용하세요.',
            '폴더가 이동, 이름 변경 또는 삭제되었다면 다른 폴더를 선택하세요.',
          ],
        },
      ],
    },
    {
      title: '누락된 미디어',
      blocks: [
        {
          kind: 'list',
          items: [
            '누락된 미디어는 DroneClean Studio가 연결된 원본 파일을 하나 이상 지금 읽을 수 없다는 뜻이에요.',
            '파일에 브라우저 권한만 다시 받으면 될 때는 **접근 허용**을 사용하세요.',
            '파일이나 폴더를 옮겼을 때는 **찾기** 또는 **폴더 찾기**를 사용하세요.',
            '미디어의 새 복사본을 DroneClean Studio에 알려 주려면 **다른 폴더 찾아보기**를 사용하세요.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: '나중에 파일을 다시 연결할 계획일 때만 **오프라인으로 작업**을 사용하세요. 그때까지 클립은 끊어진 참조로 남아요.',
        },
      ],
    },
    {
      title: '프로젝트 이동과 캐시 비우기',
      blocks: [
        {
          kind: 'list',
          items: [
            '**프로젝트 내보내기**를 사용하면 프로젝트와 미디어를 휴대 가능한 번들로 묶어, 다른 작업 공간에서 가져올 수 있어요.',
            '프로젝트 캐시 작업은 파형, 필름스트립, GIF 프레임, 디코딩된 오디오처럼 다시 만들 수 있는 데이터를 지워요.',
            '저장소 설정에서는 썸네일을 다시 생성하고, 누락된 프록시를 생성하고, 프록시를 삭제할 수도 있어요.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '캐시를 비워도 원본 미디어는 삭제되지 않아요. 프로젝트에 필요해지면 DroneClean Studio가 미리보기를 다시 생성해요.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
