import type { DocPageContent } from '../../docs-content'

const page = {
  order: 17,
  slug: 'local-ai',
  title: '로컬 AI 도구',
  description:
    '브라우저 안에서 실행되는 텍스트 음성 변환, 음악 생성, 전사와 로컬 모델 캐시를 설명해요.',
  category: 'Creative Tools',
  related: ['scene-browser', 'text-captions-subtitles', 'audio'],
  sections: [
    {
      title: '로컬 AI가 동작하는 방식',
      blocks: [
        {
          kind: 'list',
          items: [
            'AI 도구는 내 하드웨어를 사용해 브라우저 안에서 실행돼요. 서버로는 아무것도 전송되지 않아요.',
            '모델을 처음 사용할 때 한 번 다운로드한 뒤, 로컬에 캐시해 두고 다시 사용해요.',
            '모델이 실행되는 동안 상태 표시가 로딩 중, 활성, 준비됨, 오류 상태를 보여 줘요.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '일부 도구는 Chrome이나 Edge 113 이상(또는 Safari 26 이상)과 WebGPU 지원이 필요해요. 첫 모델 다운로드는 용량이 클 수 있어요.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: '모델 라이선스는 우리가 아니라 사용자에게 적용돼요. MusicGen으로 만든 음악은 비상업적 용도로만 쓸 수 있고(CC BY-NC 4.0), Supertonic 음성은 일부 용도를 금지하는 OpenRAIL-M 라이선스를 따라요. AI 탭에서 생성하기 전에 이 내용을 안내해 줘요.',
        },
      ],
    },
    {
      title: '텍스트 음성 변환',
      blocks: [
        {
          kind: 'steps',
          items: [
            '**AI** 탭을 열고 **텍스트 음성 변환**을 펼친 다음, 대본을 입력하거나 붙여넣으세요.',
            '엔진을 고른 뒤(표 참고) 음성을 선택하세요. 지원되는 경우 속도, 언어, 표현 태그도 고를 수 있어요.',
            '결과를 미리 들어 본 다음, **저장 및 삽입**으로 연결된 오디오를 재생 헤드 위치에 넣거나 **라이브러리에 저장**을 선택하세요.',
          ],
        },
        {
          kind: 'table',
          headers: ['엔진', '언어', '실행 환경'],
          rows: [
            ['Kokoro', '영어', 'WebGPU'],
            ['MOSS Nano', '20개 언어', 'CPU'],
            ['Supertonic 3', '31개 언어', '로컬 ONNX'],
          ],
        },
      ],
    },
    {
      title: '음악 생성',
      blocks: [
        {
          kind: 'list',
          items: [
            '**음악 생성**을 펼치고 프롬프트로 트랙을 설명하거나, Lo-fi chill이나 Upbeat EDM 같은 프리셋에서 시작하세요.',
            '길이를 초 단위로 설정하고 **음악 생성**을 누르세요. 처음 실행할 때는 모델을 다운로드해 캐시해요.',
            '클립을 미리 들어 본 다음 타임라인에 **저장 및 삽입**하거나 **라이브러리에 저장**하세요.',
          ],
        },
      ],
    },
    {
      title: '전사',
      blocks: [
        {
          kind: 'list',
          items: [
            '전사는 AI 탭과 별개로 미디어 라이브러리와 전사 작업 흐름에 있어요.',
            '**Parakeet**는 빠른 기본 엔진이며 여러 유럽 언어를 지원해요.',
            'Whisper 모델(Tiny, Base, Small, Large v3 Turbo)도 사용할 수 있고, 필요하면 DroneClean Studio가 Whisper로 전환해요.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '전사는 캡션, 전사 검색, 필러 단어 제거의 바탕이 되니 미리 생성해 두세요.',
        },
      ],
    },
    {
      title: '모델과 런타임 관리',
      blocks: [
        {
          kind: 'list',
          items: [
            '로컬 AI를 관리하려면 **저장소** 설정을 여세요.',
            '**로컬 AI 모델 캐시**로 다운로드한 모델을 확인하거나 지우세요. 다운로드가 손상됐을 때 유용해요.',
            '**로컬 모델 언로드**를 사용하면 런타임을 해제하고 메모리를 확보해요.',
            '오래 걸리는 작업은 결과가 더 필요 없으면 취소할 수 있어요.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
