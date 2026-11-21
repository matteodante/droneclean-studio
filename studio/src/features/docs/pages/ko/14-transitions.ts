import type { DocPageContent } from '../../docs-content'

const page = {
  order: 14,
  slug: 'transitions',
  title: '트랜지션',
  description: '컷에 트랜지션을 적용하고 스타일, 길이, 배치, 이징, 방향을 조정하는 방법이에요.',
  category: 'Creative Tools',
  related: ['timeline', 'effects-color'],
  sections: [
    {
      title: '트랜지션 적용',
      blocks: [
        {
          kind: 'steps',
          items: [
            '미디어 사이드바의 **전환** 탭을 여세요.',
            '트랜지션 카드를 이웃한 두 클립 사이의 컷으로 끌어다 놓으세요. 유효한 컷을 선택한 뒤 카드를 클릭해도 돼요.',
            '타임라인에서 트랜지션을 선택하면 속성의 **트랜지션** 섹션이 열려요.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '두 클립이 가장자리를 맞대고 있고 겹칠 만큼 원본 프레임이 남아 있으면 유효한 컷이에요. 이미 있는 트랜지션 위에 적용하면 그 자리에서 대체돼요.',
        },
      ],
    },
    {
      title: '룩 고르기',
      blocks: [
        {
          kind: 'paragraph',
          text: '카드는 카테고리별로 묶여 있어요. **기본**, **디졸브**, **모션**, **와이프**, **슬라이드**, **플립**, **마스크**, **아이리스**, **모양**, **라이트**, **색수차**가 있어요.',
        },
        {
          kind: 'list',
          items: [
            '디졸브 스타일은 기본 Cross Dissolve부터 Additive, Blur, Dip To Color 변형까지 다양해요.',
            '모션과 커스텀 스타일에는 Flip, Light Leak, Pixelate, Chromatic, Radial Blur, Glitch, Sparkles가 있어요.',
            '와이프, 슬라이드, 플립 같은 방향성 스타일은 방향마다 하나씩 여러 장의 카드로 나타나요.',
          ],
        },
      ],
    },
    {
      title: '트랜지션 조정',
      blocks: [
        {
          kind: 'table',
          headers: ['컨트롤', '동작'],
          rows: [
            ['프리셋', '컷을 다시 만들지 않고 트랜지션 스타일을 바꿔요.'],
            ['길이', '트랜지션이 재생되는 시간을 정해요. 초기화하면 1초로 돌아가요.'],
            ['배치', '컷 가운데에 놓거나, 컷 앞이나 뒤로 옮겨요.'],
            ['이징', '선형, 인, 아웃, 인 & 아웃 중에서 고르세요.'],
            ['방향', '방향성 스타일에서 왼쪽, 오른쪽, 위, 아래 중에서 고르세요.'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '타임라인에서 트랜지션의 가장자리를 직접 끌어 크기를 바꿀 수도 있어요.',
        },
      ],
    },
    {
      title: '트랜지션이 적용되지 않을 때',
      blocks: [
        {
          kind: 'note',
          tone: 'warning',
          text: '두 클립 사이에 실제 컷이 있어야 하고, 해당하는 쪽에 **소스 여유분**이 충분해야 해요. 배치가 막히면 다른 배치를 고르거나 트리밍을 덜 하세요. 유효한 컷으로 끌어다 놓는 방법은 클릭으로 적용할 수 없을 때도 항상 동작해요.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
