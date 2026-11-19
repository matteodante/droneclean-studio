import { cn } from '@/shared/ui/cn'

interface DroneCleanLogoProps {
  variant?: 'full' | 'icon'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

// Exact geometry of DroneClean's brand marks: the monogram from `mark-on-dark.svg` and
// `mark-small-on-dark.svg` (the wider cut below 20 px tall) and the wordmark from
// `wordmark-on-dark.svg`. The files the desktop app can use later are in `public/brand/`.
const monogramPaths = {
  full: [
    'M7 0L58 0A50 50 0 0 1 83.8388 7.194A44.5 44.5 0 0 0 54.7087 33.4085A21 25 0 0 0 39 25L26 25L26 75L39 75A21 25 0 0 0 54.7087 66.5915A44.5 44.5 0 0 0 83.8388 92.806A50 50 0 0 1 58 100L7 100A7 7 0 0 1 0 93L0 7A7 7 0 0 1 7 0Z',
    'M96.2889 10.001L118.5 30L102 30A20 20 0 0 0 102 70L118.5 70L96.2889 89.999A40 40 0 1 1 96.2889 10.001Z',
  ],
  simple: [
    'M7 0L58 0A50 50 0 0 1 78.3026 4.3075A49 49 0 0 0 51.6235 29.2219A21 26 0 0 0 39 24L25 24L25 76L39 76A21 26 0 0 0 51.6235 70.7781A49 49 0 0 0 78.3026 95.6925A50 50 0 0 1 58 100L7 100A7 7 0 0 1 0 93L0 7A7 7 0 0 1 7 0Z',
    'M96.2889 10.001L118.5 30L102 30A20 20 0 0 0 102 70L118.5 70L96.2889 89.999A40 40 0 1 1 96.2889 10.001Z',
  ],
} as const

const wordmarkPath =
  'M0 725V37H384Q511 37 603 77Q695 117 744 194Q793 271 793 381Q793 492 744 568.5Q695 645 603 685Q511 725 384 725ZM203 574H372Q420 574 458.5 561.5Q497 549 525 526Q553 503 568.5 469Q584 435 584 392V369Q584 326 568.5 292.5Q553 259 525 236Q497 213 458.5 200.5Q420 188 372 188H203ZM893 725V197H1043L1055 287H1064Q1079 255 1103.5 232Q1128 209 1159 197Q1190 185 1225 185Q1245 185 1263.5 187.5Q1282 190 1298 197V342H1210Q1175 342 1150 353.5Q1125 365 1109 384.5Q1093 404 1085.5 428.5Q1078 453 1078 481V725ZM1663 737Q1558 737 1480 706.5Q1402 676 1358.5 614.5Q1315 553 1315 461Q1315 368 1358.5 307Q1402 246 1480 215.5Q1558 185 1663 185Q1769 185 1847 215.5Q1925 246 1968 307Q2011 368 2011 461Q2011 553 1968 614.5Q1925 676 1847 706.5Q1769 737 1663 737ZM1663 612Q1716 612 1751 594Q1786 576 1803.5 544.5Q1821 513 1821 471V451Q1821 409 1803.5 377.5Q1786 346 1751 328.5Q1716 311 1663 311Q1611 311 1576 328.5Q1541 346 1523.5 377.5Q1506 409 1506 451V471Q1506 513 1523.5 544.5Q1541 576 1576 594Q1611 612 1663 612ZM2099 725V197H2249L2261 285H2270Q2298 248 2335 226.5Q2372 205 2413.5 195Q2455 185 2496 185Q2573 185 2624 209.5Q2675 234 2700.5 283.5Q2726 333 2726 407V725H2542V432Q2542 405 2534.5 384.5Q2527 364 2512.5 350.5Q2498 337 2476.5 330Q2455 323 2427 323Q2388 323 2355.5 339Q2323 355 2303.5 383.5Q2284 412 2284 450V725ZM3168 737Q3060 737 2980 708Q2900 679 2855.5 617.5Q2811 556 2811 461Q2811 369 2854.5 307.5Q2898 246 2976.5 215.5Q3055 185 3160 185Q3270 185 3347.5 215Q3425 245 3466 305Q3507 365 3507 455V498H3005Q3007 540 3027 567Q3047 594 3083.5 606.5Q3120 619 3170 619Q3197 619 3222 613.5Q3247 608 3267.5 598Q3288 588 3300.5 573Q3313 558 3315 540H3505Q3505 585 3480 621.5Q3455 658 3410 684Q3365 710 3303 723.5Q3241 737 3168 737ZM3005 400H3310Q3310 378 3299.5 360Q3289 342 3269.5 329.5Q3250 317 3223.5 310Q3197 303 3166 303Q3119 303 3084.5 315Q3050 327 3030 349Q3010 371 3005 400ZM4016 737Q3872 737 3776 696.5Q3680 656 3632 577Q3584 498 3584 381Q3584 210 3694.5 117.5Q3805 25 4017 25Q4135 25 4225 60.5Q4315 96 4365.5 160.5Q4416 225 4416 313H4218Q4218 270 4192.5 239.5Q4167 209 4121 192.5Q4075 176 4014 176Q3942 176 3893 200.5Q3844 225 3818.5 268Q3793 311 3793 368V393Q3793 450 3818.5 493.5Q3844 537 3892.5 561.5Q3941 586 4011 586Q4077 586 4124.5 570.5Q4172 555 4197.5 525Q4223 495 4223 453H4417Q4417 538 4368 602Q4319 666 4229.5 701.5Q4140 737 4016 737ZM4516 725V0H4701V725ZM5145 737Q5037 737 4957 708Q4877 679 4832.5 617.5Q4788 556 4788 461Q4788 369 4831.5 307.5Q4875 246 4953.5 215.5Q5032 185 5137 185Q5247 185 5324.5 215Q5402 245 5443 305Q5484 365 5484 455V498H4982Q4984 540 5004 567Q5024 594 5060.5 606.5Q5097 619 5147 619Q5174 619 5199 613.5Q5224 608 5244.5 598Q5265 588 5277.5 573Q5290 558 5292 540H5482Q5482 585 5457 621.5Q5432 658 5387 684Q5342 710 5280 723.5Q5218 737 5145 737ZM4982 400H5287Q5287 378 5276.5 360Q5266 342 5246.5 329.5Q5227 317 5200.5 310Q5174 303 5143 303Q5096 303 5061.5 315Q5027 327 5007 349Q4987 371 4982 400ZM5776 737Q5727 737 5684.5 730Q5642 723 5610.5 705.5Q5579 688 5561.5 657.5Q5544 627 5544 580Q5544 517 5578 480.5Q5612 444 5675 427.5Q5738 411 5823.5 406.5Q5909 402 6012 402V386Q6012 355 5996.5 337Q5981 319 5951.5 311Q5922 303 5878 303Q5846 303 5816 308Q5786 313 5767 323.5Q5748 334 5748 352V360H5561Q5560 356 5560 353Q5560 350 5560 345Q5560 298 5597 262Q5634 226 5707 205.5Q5780 185 5887 185Q5987 185 6056 202.5Q6125 220 6160.5 258.5Q6196 297 6196 362V573Q6196 590 6204 601Q6212 612 6229 612H6282V718Q6268 724 6237 730.5Q6206 737 6171 737Q6122 737 6092 727Q6062 717 6047.5 699.5Q6033 682 6027 661H6019Q5991 684 5953.5 701.5Q5916 719 5872 728Q5828 737 5776 737ZM5828 620Q5851 620 5881.5 614.5Q5912 609 5942 598Q5972 587 5992 569.5Q6012 552 6012 527V497Q5913 497 5850 505Q5787 513 5757 529.5Q5727 546 5727 572Q5727 592 5741.5 602.5Q5756 613 5779.5 616.5Q5803 620 5828 620ZM6327 725V197H6477L6489 285H6498Q6526 248 6563 226.5Q6600 205 6641.5 195Q6683 185 6724 185Q6801 185 6852 209.5Q6903 234 6928.5 283.5Q6954 333 6954 407V725H6770V432Q6770 405 6762.5 384.5Q6755 364 6740.5 350.5Q6726 337 6704.5 330Q6683 323 6655 323Q6616 323 6583.5 339Q6551 355 6531.5 383.5Q6512 412 6512 450V725Z'

const MONOGRAM_AMBER = '#FFB938'

// The monogram is as tall as the wordmark's capitals, on the same baseline, with a gap of 0.4 of
// that height between them — the proportions of the brand lockup.
const sizeConfig = {
  sm: {
    height: 'h-4',
    mark: 'h-4',
    wordmark: 'h-4',
    studio: 'text-[11px]',
    gap: 'gap-1.5',
    studioGap: 'gap-1',
    detail: 'simple',
  },
  md: {
    height: 'h-7',
    mark: 'h-7',
    wordmark: 'h-7',
    studio: 'text-lg',
    gap: 'gap-3',
    studioGap: 'gap-1.5',
    detail: 'full',
  },
  lg: {
    height: 'h-10',
    mark: 'h-10',
    wordmark: 'h-10',
    studio: 'text-2xl',
    gap: 'gap-4',
    studioGap: 'gap-2',
    detail: 'full',
  },
} as const

function Monogram({ detail, className }: { detail: 'full' | 'simple'; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 118.5 100"
      className={cn('w-auto shrink-0', className)}
      aria-hidden="true"
      focusable="false"
    >
      <g fill={MONOGRAM_AMBER}>
        {monogramPaths[detail].map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  )
}

function Wordmark({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 6954 737"
      className={cn('w-auto shrink-0 text-foreground', className)}
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={wordmarkPath} />
    </svg>
  )
}

export function DroneCleanLogo({ variant = 'full', size = 'md', className }: DroneCleanLogoProps) {
  const config = sizeConfig[size]

  if (variant === 'icon') {
    return (
      <div
        role="img"
        aria-label="DroneClean Studio"
        className={cn('flex items-start', config.height, className)}
      >
        <Monogram detail={config.detail} className={config.mark} />
      </div>
    )
  }

  // The marks sit at the top of a box as tall as the brand mark; the line box around "Studio"
  // (no descender in the name) spills below the box without moving the monogram off the baseline.
  return (
    <div
      role="img"
      aria-label="DroneClean Studio"
      className={cn('flex items-start', config.height, config.gap, className)}
    >
      <Monogram detail={config.detail} className={config.mark} />
      <span className={cn('inline-flex items-baseline', config.studioGap)}>
        <span className="inline-block">
          <Wordmark className={config.wordmark} />
        </span>
        <span
          className={cn('inline-block font-medium tracking-tight text-foreground', config.studio)}
        >
          Studio
        </span>
      </span>
    </div>
  )
}
