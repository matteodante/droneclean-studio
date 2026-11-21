import type { DocPageContent } from '../../docs-content'

const page = {
  order: 1,
  slug: 'getting-started',
  title: '시작하기',
  description:
    'DroneClean Studio가 무엇인지, 브라우저에 어떤 조건이 필요한지, 실행부터 내보내기까지 첫 편집을 어떻게 하는지 알아봐요.',
  category: 'Start',
  related: ['concepts', 'workspaces', 'export'],
  sections: [
    {
      title: 'DroneClean Studio란',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio는 브라우저 안에서 완전히 동작하는 **로컬 우선** 동영상 편집기예요. 계정도, 업로드도, 서버 렌더링도 필요 없어요. 편집, 효과, 색 보정, AI 도구, 내보내기까지 모두 내 컴퓨터의 GPU와 CPU로 처리해요.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '미디어는 내 기기 밖으로 나가지 않아요. DroneClean Studio는 원본 파일을 연결만 해 두고, 프로젝트, 캐시, 내보낸 파일은 직접 고른 **작업 공간 폴더**에 저장해요. 클라우드로는 아무것도 전송되지 않아요.',
        },
      ],
    },
    {
      title: '브라우저 요구 사항',
      blocks: [
        {
          kind: 'paragraph',
          text: 'DroneClean Studio는 최신 웹 API를 사용하므로 최신 Chromium 기반 브라우저를 권장해요.',
        },
        {
          kind: 'table',
          headers: ['브라우저', '지원 상태'],
          rows: [
            ['Chrome / Edge 113 이상', '완전 지원'],
            ['Brave', 'File System Access API 플래그를 켜면 사용 가능'],
            ['Safari / Firefox', '전체 작업 흐름은 아직 지원하지 않음'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'DroneClean Studio는 File System Access API(작업 공간 폴더), WebCodecs(디코딩과 내보내기), WebGPU(효과, 색 보정, AI), OPFS(캐시)를 사용해요. 하드웨어 가속을 켜 두고 GPU 드라이버를 최신으로 유지하세요.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Brave는 폴더 접근을 막을 수 있어요. `brave://flags/#file-system-access-api`를 열어 **Enabled**로 바꾼 뒤 Brave를 다시 실행하세요.',
        },
      ],
    },
    {
      title: '첫 편집 해 보기',
      blocks: [
        {
          kind: 'steps',
          items: [
            '지원되는 브라우저에서 DroneClean Studio를 열고, 안내가 나오면 읽고 쓸 수 있는 **작업 공간 폴더**를 선택하세요.',
            '프로젝트 페이지에서 **새 프로젝트**를 선택하고 편집에 쓸 해상도와 프레임 속도를 설정하세요.',
            '**미디어** 탭을 열고 **가져오기**로 파일을 추가하거나, 미디어를 라이브러리에 바로 끌어다 놓으세요.',
            '미디어 패널에서 클립을 타임라인 트랙으로 끌어다 놓으세요.',
            '`Space`를 눌러 재생하고, `Left`와 `Right`로 한 프레임씩 이동하세요.',
            '작업하는 동안 `Ctrl+S`로 저장하고, 마치면 **내보내기**를 선택해 완성된 영상을 렌더링하세요.',
          ],
        },
      ],
    },
    {
      title: '설정이 제대로 되었는지 확인하기',
      blocks: [
        {
          kind: 'list',
          items: [
            '작업 공간 선택 창이 열리고, 일반 폴더(보호된 시스템 위치가 아닌 폴더)를 받아들여요.',
            '가져온 미디어가 미디어 패널에 썸네일이 있는 카드로 나타나요.',
            '`Space`를 누르면 타임라인에서 재생이 시작돼요.',
            '내보내기가 열리고, 사전 점검에서 진행을 막는 문제가 보고되지 않아요.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '어느 단계든 실패한다면 **문제 해결** 페이지에서 해당 증상을 찾아보세요.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
