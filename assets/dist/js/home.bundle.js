var a={heroStats:[{value:"24/7",label:"Monitoring and response across active assets"},{value:"18+",label:"Years of combined leadership experience"},{value:"99.2%",label:"Asset availability target in current cycle"}],detailCards:[{title:"Exploration and Production",description:"Structured field development plans with disciplined cost controls and asset-level performance reporting."},{title:"Safety and Compliance",description:"Operational policies aligned with federal and state requirements, with routine drills and documented inspections."},{title:"Logistics and Delivery",description:"Coordinated transport planning with quality checks from extraction points through downstream partners."}]};function c(e,n){let r=document.createElement("a");return r.href=e,r.textContent=n,r}var l=["admin.read_only","employees.read","voyages.config.manage","user_groups.manage","user_ranks.manage","config.manage","activity_tracker.view"];var d=[{href:"/my-details",label:"My Details"},{href:"/voyage-tracker",label:"Voyage Tracker"},{href:"/fleet",label:"Fleet",anyPermissions:["voyages.read"]},{href:"/finances",label:"Finances"},{href:"/admin-panel",label:"Admin Panel",anyPermissions:l}];function i(){let e=document.querySelector(".site-nav");e&&(e.innerHTML="",d.forEach(n=>{e.append(c(n.href,n.label))}))}function u(e,n){n&&(n.innerHTML=`
    <h2>Snapshot</h2>
    <ul class="stat-list">
      ${e.map(r=>`
            <li>
              <strong>${r.value}</strong>
              <span>${r.label}</span>
            </li>
          `).join("")}
    </ul>
  `)}function m(e,n){n&&(n.innerHTML=e.map(r=>`
        <article class="panel detail-card">
          <h3>${r.title}</h3>
          <p>${r.description}</p>
        </article>
      `).join(""))}function o(e){u(e.heroStats,document.querySelector("#heroStats")),m(e.detailCards,document.querySelector("#detailCards"))}function s(e="#currentYear"){let n=document.querySelector(e);n&&(n.textContent=String(new Date().getFullYear()));let r=window.location.pathname.replace(/\/+$/,"")||"/";document.querySelectorAll(".site-nav a[href]").forEach(t=>{try{(new URL(t.getAttribute("href")||"",window.location.origin).pathname.replace(/\/+$/,"")||"/")===r?(t.classList.add("is-active"),t.setAttribute("aria-current","page")):(t.classList.remove("is-active"),t.removeAttribute("aria-current"))}catch{}})}async function p(){i();try{let e=await fetch("/api/auth/session",{method:"GET",credentials:"include"});if((e.ok?await e.json():{loggedIn:!1}).loggedIn){window.location.href="/my-details";return}}catch{}o(a),s()}p();
