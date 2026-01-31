export type DummyUtterance = {
  id: string;
  ts: string;
  text: string;
};

const DUMMY: DummyUtterance[] = [
  { id: "call-1001", ts: new Date().toISOString(), text: "패스트 캠퍼스 해커톤 재밋냐?" },
  { id: "call-1002", ts: new Date().toISOString(), text: "응 재밌는거같은데 " },
  { id: "call-1003", ts: new Date().toISOString(), text: "상담 연결이 몇 분째예요. 사람을 무시하는 건가요?" },
  { id: "call-1004", ts: new Date().toISOString(), text: "어제도 똑같이 얘기했는데 왜 또 설명해야 하죠?" },
];

let idx = 0;
export function nextDummyUtterance(): DummyUtterance {
  const item = DUMMY[idx % DUMMY.length];
  idx += 1;
  return { ...item, ts: new Date().toISOString() };
}
