import type { DocPageContent } from '../../docs-content'

const page = {
  order: 13,
  slug: 'effects-color',
  title: '효과와 색상',
  description:
    'GPU 효과를 추가하고 쌓고, 휠과 곡선으로 색 보정하고, 스코프를 읽고, LUT를 적용하고, 보정을 일부 영역에만 적용하는 방법이에요.',
  category: 'Creative Tools',
  related: ['keyframes', 'shapes-masks', 'properties'],
  sections: [
    {
      title: '효과 추가와 관리',
      blocks: [
        {
          kind: 'steps',
          items: [
            '클립을 선택하고 속성의 **효과** 섹션을 여세요.',
            '**효과 추가**를 누른 다음 검색하거나 카테고리에서 고르세요. 기본 제공 **프리셋**이나 직접 저장한 프리셋도 추가할 수 있어요.',
            '**위로 이동**과 **아래로 이동**으로 스택 순서를 바꾸세요. 순서에 따라 효과가 합쳐지는 결과가 달라져요.',
            '효과 패널에서 효과를 비활성화하거나, 초기화하거나, 제거할 수 있어요. 숫자 매개변수에는 키프레임을 지정할 수 있어요.',
          ],
        },
      ],
    },
    {
      title: '효과 카탈로그',
      blocks: [
        {
          kind: 'table',
          headers: ['카테고리', '효과'],
          rows: [
            [
              '색상',
              'Brightness, Contrast, Exposure, Saturation, Vibrance, Hue Shift, Temperature, Levels, Curves, Color Wheels, Gradient Map, LUT',
            ],
            ['블러', 'Gaussian, Box, Motion, Radial, Zoom'],
            [
              '왜곡',
              'Pixelate, RGB Split, Twirl, Wave, Bulge/Pinch, Kaleidoscope, Mirror, Fluted Glass, Ripple Glass, Glass Mosaic, Blocks, Droste 등',
            ],
            [
              '스타일',
              'Vignette, Film Grain, Sharpen, Glow, Scanlines, CRT, VHS, Halftone, Dither, ASCII, Ink, Pixel Sort, Block Glitch, Color Glitch',
            ],
            ['키잉', 'Chroma Key (그린 스크린과 블루 스크린 제거)'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '모든 효과는 GPU(WebGPU)에서 렌더링돼요. 최근에 **Gradient Map**, **VHS**, **CRT**, **Droste**, **Block Glitch**, 왜곡 효과인 **Ripple Glass**와 **Glass Mosaic**, **Ink**, **Pixel Sort**가 추가됐어요.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '**ASCII**는 직접 정한 문자로 렌더링할 수 있어요. **Character Set**을 **사용자 지정**으로 바꾸고, **사용자 문자**를 입력한 다음(가장 짙은 문자부터 가장 옅은 문자 순서로 적어요) **글꼴**(Monospace, Courier, Consolas, Lucida Console)을 고르세요. 기본 제공 세트로 ASCII Ramp, Dense, Binary, Symbols가 있어요.',
        },
      ],
    },
    {
      title: '색상 입력과 스포이드',
      blocks: [
        {
          kind: 'list',
          items: [
            '모든 색상 컨트롤은 **hex** 값을 받아요. 필드에 직접 입력하면 입력하는 동안 미리보기가 갱신돼요.',
            '투명도를 지원하는 곳에서는 필드가 8자리 hex(`#rrggbbaa`)를 받고, 색상 선택기에 알파 슬라이더가 추가돼요.',
            '**스포이드**를 클릭하면 앱 안이나 미리보기의 어느 곳에서든 색을 추출할 수 있어요. 돋보기 확대경이 커서를 따라다니므로 정확한 픽셀을 짚은 뒤 클릭해 적용하세요.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '스포이드는 브라우저 기본 기능이 아니라 앱에 내장된 추출 도구라서 권한 요청이 필요 없어요. 컬러 작업 영역의 휠에도 같은 도구가 쓰여요.',
        },
      ],
    },
    {
      title: '컬러 작업 영역에서 색 보정하기',
      blocks: [
        {
          kind: 'list',
          items: [
            '**컬러** 작업 영역(`Alt+2`)으로 전환하고 클립을 선택하세요. 색 보정을 아직 하지 않았어도 휠과 곡선을 바로 쓸 수 있어요.',
            '**컬러 휠**로 어두운 영역, 중간톤, 밝은 영역, 오프셋을 조정해요. 화이트 밸런스 스포이드와 자동 밸런스도 있어요.',
            '**곡선**으로 마스터, 빨강, 초록, 파랑 채널을 편집해요. 곡선을 클릭하면 포인트가 추가되고, 포인트를 더블 클릭하면 제거돼요.',
            '**이전**, **이후**, **분할**로 비교하고, **색 보정 복사**와 **색 보정 붙여넣기**로 클립 사이에 룩을 옮기세요.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: '**색 보정 바이패스**는 보정하지 않은 이미지를 미리 보여 주지만 내보내기에는 영향을 주지 않아요.',
        },
      ],
    },
    {
      title: '스코프 읽기',
      blocks: [
        {
          kind: 'table',
          headers: ['스코프', '보여 주는 것'],
          rows: [
            ['파형', '위에서 아래로 보는 휘도와 색상 분포'],
            ['RGB 퍼레이드', '빨강, 초록, 파랑 채널을 나란히 보여 줘요'],
            ['벡터스코프', '색조와 채도'],
            ['히스토그램', '톤의 분포'],
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: '**색상 스코프 표시**로 스코프를 켜고 끄세요. 파형과 히스토그램은 RGB, 단일 채널, 루마(Y) 보기도 제공해요.',
        },
      ],
    },
    {
      title: 'LUT와 부분 보정',
      blocks: [
        {
          kind: 'list',
          items: [
            '**LUT (.cube)** 효과를 추가하고 **.cube LUT 가져오기**를 선택한 다음, **강도**로 섞는 정도를 조절하세요.',
            '**보조 퀄리파이어**는 색조, 채도, 휘도 범위에 맞춰 보정을 키잉해요.',
            '**파워 윈도우**는 보정을 타원이나 사각형 마스크로 제한하며, 페더와 반전을 지원해요.',
            '**조정 레이어**를 추가하면 그 아래 트랙에 있는 모든 클립에 색 보정이나 효과를 적용할 수 있어요.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'LUT 가져오기에는 Chromium 기반 브라우저가 필요해요.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
