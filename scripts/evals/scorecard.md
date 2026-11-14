# Vali eval scorecard

2026-11-14 05:42 UTC · https://bogdan-c-2206--vali-web.us-east.modal.run · **20/21 passed** · $1.61 total · errands in `errands.json`

| # | Errand | Site | Pass | Mode (want) | s | Cost | Exa calls | Result / failure | Task |
|---|---|---|---|---|---|---|---|---|---|
| 1 | find-sauna | public saunas (Helsinki) | PASS | find (find) | 5 | $0.007 | search 1 | research ok | `t_b927308ac173433499a055855dd78062` |
| 2 | find-laptop | shop (Verkkokauppa.com, Gigantti) | PASS | find (find) | 7 | $0.007 | search 1 | research ok | `t_1f81c8f249b04818be1b730b49e3cf82` |
| 3 | find-hsl | HSL (transport) | PASS | find (find/check) | 7 | $0.007 | search 1 | research ok | `t_ee838b75e0ff4771a4f347302e38bcb1` |
| 4 | check-kela-housing | Kela | PASS | check (check/claim) | 24 | $0.025 | agent 1 | research ok | `t_a88bb73350f54d78bc488d7905b563c7` |
| 5 | check-lease-clause | lease clause (selected text) | PASS | check (check) | 23 | $0.025 | agent 1 | research ok | `t_ba78a4b09e6e4032a1c73a8d75b1279a` |
| 6 | check-migri-extension | Migri | PASS | check (check/claim) | 24 | $0.025 | agent 1 | research ok | `t_fc91251073ea4a0da6ae98a08dd74fce` |
| 7 | check-pdf-guide | PDF (Kela benefit guide) | PASS | check (check) | 24 | $0.025 | agent 1 | research ok | `t_ed45b31691b746209a4f68cd1bb4d501` |
| 8 | check-bank-account | bank page (Nordea) | PASS | check (check) | 34 | $0.025 | agent 1 | research ok | `t_0593cbd237b742e79c8fbf26a47274b8` |
| 9 | claim-eu261 | airline (EU261) | PASS | claim (claim) | 23 | $0.025 | agent 1 | research ok | `t_5dcaaf1c8e8d4592ab8995572c77e566` |
| 10 | claim-vr-delay | VR (trains) | PASS | claim (claim) | 23 | $0.025 | agent 1 | research ok | `t_8b831aacb9ce419d8e77e4f90a538cff` |
| 11 | claim-vero-taxcard | Vero | PASS | claim (claim/check) | 23 | $0.025 | agent 1 | research ok | `t_4621e5a377e8434e88bfd3c72d7dec0e` |
| 12 | claim-pothole-form | city service form (Helsinki) | PASS | write (claim/write/check) | 133 | $0.260 | agent 1 | approval with 8 values | `t_8e78685160784e24aa62e32dd5764a97` |
| 13 | execute-lookup-httpbin | httpbin test order form, facts looked up with Exa | PASS | book (write/book/claim/check) | 69 | $0.100 | agent 1, sandbox_search 2 | approval with 6 values | `t_90c4beca30d64c4488474e425f50999b` |
| 14 | claim-ta-defect | landlord fault report (TA, iframe form with preview) | PASS | write (claim/write/check) | 69 | $0.147 | agent 1 | approval with 10 values | `t_52b307f8882c4077b90e9ee004c35924` |
| 15 | book-sauna | sauna booking (Löylykontti) | FAIL | book (book) | 113 | $0.291 | agent 1 | sandbox failed after 22 steps: needs payment: everything is filled (Sörnäinen, Sauna 2 "Suvi", Sat 21 Nov 19:30–21:30, shared sauna, 8 people, 2 h, total €208.00, your details entered), but online banking requires choosing your bank and that choice is yours. Pick your bank under Online banking, then | `t_c5ca5ae7224e4069b05fa3893156ec02` |
| 16 | book-restaurant | restaurant booking (Magu, found by research) | PASS | book (book) | 100 | $0.231 | agent 1 | handoff | `t_9c7b09e63296438490016382d4614c80` |
| 17 | book-allas-tickets | multi-step shop wizard (Allas Sea Pool) | PASS | book (book/find) | 79 | $0.179 | agent 1 | approval with 6 values | `t_6d78ba9adeb14c14952a0ad72761d446` |
| 18 | book-badminton | sports venue booking (found by research) | PASS | book (book) | 57 | $0.133 | agent 1 | handoff | `t_7d7b03f714fc4e9cb7353e0e691f84ee` |
| 19 | write-landlord | email draft (landlord) | PASS | write (write) | 12 | $0.025 | agent 1 | research ok | `t_5579a5978b6f475a84053abf3565b6d6` |
| 20 | write-university | university page (University of Helsinki) | PASS | write (write) | 23 | $0.025 | agent 1 | research ok | `t_687e30cfe42246d5a275a9a8e1fd1eb6` |
| 21 | watch-flat | housing listings (watch) | PASS | watch (watch) | 3 | $0.000 | monitor 1 | research ok | `t_00443f62af03433f95c59be87e37a4e2` |
