import './mark-unread.css';
import React from 'dom-chef';
import select from 'select-dom';
import delegate, {DelegateSubscription, DelegateEvent} from 'delegate-it';
import features from '../libs/features';
import observeEl from '../libs/simplified-element-observer';
import * as icons from '../libs/icons';
import * as pageDetect from '../libs/page-detect';
import {safeElementReady} from '../libs/dom-utils';
import {getUsername, getOwnerAndRepo} from '../libs/utils';

type NotificationType = 'pull-request' | 'issue';
type NotificationState = 'open' | 'merged' | 'closed' | 'draft';

interface Participant {
	username: string;
	avatar: string;
}

interface Notification {
	participants: Participant[];
	state: NotificationState;
	isParticipating: boolean;
	repository: string;
	dateTitle: string;
	title: string;
	type: NotificationType;
	date: string;
	url: string;
}

const listeners: DelegateSubscription[] = [];
const stateIcons = {
	issue: {
		open: icons.openIssue,
		closed: icons.closedIssue,
		merged: icons.closedIssue, // Required just for TypeScript
		draft: icons.closedIssue // Required just for TypeScript
	},
	'pull-request': {
		open: icons.openPullRequest,
		closed: icons.closedPullRequest,
		merged: icons.mergedPullRequest,
		draft: icons.openPullRequest
	}
};

async function getNotifications(): Promise<Notification[]> {
	const {unreadNotifications} = await browser.storage.local.get({
		unreadNotifications: []
	});
	return unreadNotifications;
}

async function setNotifications(unreadNotifications: Notification[]): Promise<void> {
	return browser.storage.local.set({unreadNotifications});
}

function stripHash(url: string): string {
	return url.replace(/#.+$/, '');
}

function addMarkUnreadButton(): void {
	if (!select.exists('.rgh-btn-mark-unread')) {
		select('.thread-subscription-status')!.after(
			<button className="btn btn-sm rgh-btn-mark-unread" onClick={markUnread}>
				Mark as unread
			</button>
		);
	}
}

async function markRead(urls: string|string[]): Promise<void> {
	if (!Array.isArray(urls)) {
		urls = [urls];
	}

	const cleanUrls = urls.map(stripHash);

	for (const a of select.all<HTMLAnchorElement>('a.js-notification-target')) {
		if (cleanUrls.includes(a.getAttribute('href')!)) {
			a.closest('li.js-notification')!.classList.replace('unread', 'read');
		}
	}

	const notifications = await getNotifications();
	const updated = notifications.filter(({url}) => !cleanUrls.includes(url));
	await setNotifications(updated);
}

async function markUnread({currentTarget}: React.MouseEvent): Promise<void> {
	const participants: Participant[] = select.all('.participant-avatar').slice(0, 3).map(el => ({
		username: el.getAttribute('aria-label')!,
		avatar: el.querySelector('img')!.src
	}));

	const {ownerName, repoName} = getOwnerAndRepo();
	const stateLabel = select('.gh-header-meta .State')!;
	let state: NotificationState;

	if (stateLabel.classList.contains('State--green')) {
		state = 'open';
	} else if (stateLabel.classList.contains('State--purple')) {
		state = 'merged';
	} else if (stateLabel.classList.contains('State--red')) {
		state = 'closed';
	} else if (stateLabel.title.includes('Draft')) {
		state = 'draft';
	} else {
		throw new Error('Refined GitHub: A new issue state was introduced?');
	}

	const lastCommentTime = select.last<HTMLTimeElement>('.timeline-comment-header relative-time');
	const unreadNotifications = await getNotifications();

	unreadNotifications.push({
		participants,
		state,
		isParticipating: select.exists(`.participant-avatar[href="/${getUsername()}"]`),
		repository: `${ownerName}/${repoName}`,
		dateTitle: lastCommentTime!.title,
		title: select('.js-issue-title')!.textContent!.trim(),
		type: pageDetect.isPR() ? 'pull-request' : 'issue',
		date: lastCommentTime!.getAttribute('datetime')!,
		url: stripHash(location.href)
	});

	await setNotifications(unreadNotifications);
	await updateUnreadIndicator();

	currentTarget.setAttribute('disabled', 'disabled');
	currentTarget.textContent = 'Marked as unread';
}

function getNotification(notification: Notification): Element {
	const {
		participants,
		dateTitle,
		title,
		state,
		type,
		date,
		url
	} = notification;

	const existing = select(`a.js-notification-target[href^="${stripHash(url)}"]`);
	if (existing) {
		const item = existing.closest('.js-notification')!;
		item.classList.replace('read', 'unread');
		return item;
	}

	const usernames = participants
		.map(participant => participant.username)
		.join(' and ')
		.replace(/ and (.+) and/, ', $1, and'); // 3 people only: A, B, and C

	const avatars = participants.map(participant =>
		<a href={`/${participant.username}`} className="avatar">
			<img alt={`@${participant.username}`} height="20" src={participant.avatar} width="20"/>
		</a>
	);

	return (
		<li className={`list-group-item js-notification js-navigation-item unread ${type}-notification rgh-unread`}>
			<span className="list-group-item-name css-truncate">
				<span className={`type-icon type-icon-state-${state}`}>
					{stateIcons[type][state]()}
				</span>
				<a className="css-truncate-target js-notification-target js-navigation-open list-group-item-link" href={url}
					data-hovercard-url={`${url}/hovercard?show_subscription_status=true`}>
					{title}
				</a>
			</span>
			<ul className="notification-actions">
				<li className="delete">
					<button className="btn-link delete-note">
						{icons.check()}
					</button>
				</li>
				<li className="mute tooltipped tooltipped-w" aria-label={`${type === 'issue' ? 'Issue' : 'PR'} manually marked as unread`}>
					{icons.info()}
				</li>
				<li className="age">
					<relative-time datetime={date} title={dateTitle}/>
				</li>
				<div className="AvatarStack AvatarStack--three-plus AvatarStack--right clearfix d-inline-block" style={{marginTop: 1}}>
					<div className="AvatarStack-body tooltipped tooltipped-sw tooltipped-align-right-1" aria-label={usernames}>
						{avatars}
					</div>
				</div>
			</ul>
		</li>
	);
}

function getNotificationGroup({repository}: Notification): Element {
	const existing = select(`a.notifications-repo-link[title="${repository}"]`)!;
	if (existing) {
		return existing.closest('.boxed-group')!;
	}

	return (
		<div className="boxed-group flush">
			<form className="boxed-group-action">
				<button className="mark-all-as-read css-truncate js-mark-all-read">
					{icons.check()}
				</button>
			</form>

			<h3>
				<a href={'/' + repository} className="css-truncate css-truncate-target notifications-repo-link" title={repository}>
					{repository}
				</a>
			</h3>

			<ul className="boxed-group-inner list-group notifications"/>
		</div>
	);
}

async function renderNotifications(unreadNotifications: Notification[]): Promise<void> {
	unreadNotifications = unreadNotifications.filter(shouldNotificationAppearHere);

	if (unreadNotifications.length === 0) {
		return;
	}

	// Don’t simplify selector, it’s for cross-extension compatibility
	let pageList = (await safeElementReady('#notification-center .notifications-list'))!;

	if (!pageList) {
		pageList = <div className="notifications-list"></div>;
		select('.blankslate')!.replaceWith(pageList);
	}

	unreadNotifications.reverse().forEach(notification => {
		const group = getNotificationGroup(notification);
		const item = getNotification(notification);

		pageList.prepend(group);
		group
			.querySelector('ul.notifications')!
			.prepend(item);
	});

	// Make sure that all the boxes with unread items are at the top
	// This is necessary in the "All notifications" view
	for (const repo of select.all('.boxed-group').reverse()) {
		if (select.exists('.unread', repo)) {
			pageList.prepend(repo);
		}
	}
}

function shouldNotificationAppearHere(notification: Notification): boolean {
	if (isSingleRepoPage()) {
		return isCurrentSingleRepoPage(notification);
	}

	if (isParticipatingPage()) {
		return notification.isParticipating;
	}

	return true;
}

function isSingleRepoPage(): boolean {
	return location.pathname.split('/')[3] === 'notifications';
}

function isCurrentSingleRepoPage({repository}: Notification): boolean {
	const [, singleRepo = ''] = /^[/](.+[/].+)[/]notifications/.exec(location.pathname) || [];
	return singleRepo === repository;
}

function isParticipatingPage(): boolean {
	return location.pathname.startsWith('/notifications/participating');
}

async function updateUnreadIndicator(): Promise<void> {
	const icon = select<HTMLAnchorElement>('a.notification-indicator')!; // "a" required in responsive views
	if (!icon) {
		return;
	}

	const statusMark = icon.querySelector('.mail-status')!;
	if (!statusMark) {
		return;
	}

	const hasRealNotifications = icon.matches('[data-ga-click$=":unread"]');
	const rghUnreadCount = (await getNotifications()).length;

	const hasUnread = hasRealNotifications || rghUnreadCount > 0;
	const label = hasUnread ? 'You have unread notifications' : 'You have no unread notifications';

	icon.setAttribute('aria-label', label);
	statusMark.classList.toggle('unread', hasUnread);

	if (rghUnreadCount > 0) {
		icon.dataset.rghUnread = String(rghUnreadCount); // Store in attribute to let other extensions know
	} else {
		delete icon.dataset.rghUnread;
	}
}

async function markNotificationRead({delegateTarget}: DelegateEvent): Promise<void> {
	const {href} = delegateTarget
		.closest('li.js-notification')!
		.querySelector<HTMLAnchorElement>('a.js-notification-target')!;
	await markRead(href);
	await updateUnreadIndicator();
}

async function markAllNotificationsRead(event: DelegateEvent): Promise<void> {
	event.preventDefault();
	const repoGroup = event.delegateTarget.closest('.boxed-group')!;
	const urls = select.all<HTMLAnchorElement>('a.js-notification-target', repoGroup).map(a => a.href);
	await markRead(urls);
	await updateUnreadIndicator();
}

async function markVisibleNotificationsRead({delegateTarget}: DelegateEvent): Promise<void> {
	const group = delegateTarget.closest('.boxed-group')!;
	const repo = select('.notifications-repo-link', group)!.textContent;
	const notifications = await getNotifications();
	setNotifications(notifications.filter(({repository}) => repository !== repo));
}

function addCustomAllReadBtn(): void {
	const nativeMarkUnreadForm = select('details [action="/notifications/mark"]');
	if (nativeMarkUnreadForm) {
		nativeMarkUnreadForm.addEventListener('submit', () => {
			setNotifications([]);
		});
		return;
	}

	select('.tabnav .float-right')!.append(
		<details className="details-reset details-overlay details-overlay-dark lh-default text-gray-dark d-inline-block text-left">
			<summary className="btn btn-sm" aria-haspopup="dialog">
				Mark all as read
			</summary>
			<details-dialog className="Box Box--overlay d-flex flex-column anim-fade-in fast " aria-label="Are you sure?" role="dialog" tabindex="-1">
				<div className="Box-header">
					<button className="Box-btn-octicon btn-octicon float-right" type="button" aria-label="Close dialog" data-close-dialog="">
						{icons.x()}
					</button>
					<h3 className="Box-title">Are you sure?</h3>
				</div>

				<div className="Box-body">
					<p>Are you sure you want to mark all unread notifications as read?</p>
					<button type="button" className="btn btn-block" id="clear-local-notification">Mark all notifications as read</button>
				</div>
			</details-dialog>
		</details>
	);

	delegate('#clear-local-notification', 'click', async () => {
		await setNotifications([]);
		location.reload();
	});
}

function updateLocalNotificationsCount(localNotifications: Notification[]): void {
	const unreadCount = select('#notification-center .filter-list a[href="/notifications"] .count')!;
	const githubNotificationsCount = Number(unreadCount.textContent);
	unreadCount.textContent = String(githubNotificationsCount + localNotifications.length);
}

function updateLocalParticipatingCount(notifications: Notification[]): void {
	const participatingNotifications = notifications
		.filter(({isParticipating}) => isParticipating)
		.length;

	if (participatingNotifications > 0) {
		const unreadCount = select('#notification-center .filter-list a[href="/notifications/participating"] .count')!;
		const githubNotificationsCount = Number(unreadCount.textContent);
		unreadCount.textContent = String(githubNotificationsCount + participatingNotifications);
	}
}

function destroy(): void {
	for (const listener of listeners) {
		listener.destroy();
	}

	listeners.length = 0;
}

async function init(): Promise<void> {
	destroy();

	if (pageDetect.isNotifications()) {
		const notifications = await getNotifications();
		if (notifications.length > 0) {
			await renderNotifications(notifications);
			addCustomAllReadBtn();
			updateLocalNotificationsCount(notifications);
			updateLocalParticipatingCount(notifications);
			document.dispatchEvent(new CustomEvent('refined-github:mark-unread:notifications-added'));
		}

		listeners.push(
			delegate('.btn-link.delete-note', 'click', markNotificationRead),
			delegate('.js-mark-all-read', 'click', markAllNotificationsRead),
			delegate('.js-delete-notification button', 'click', updateUnreadIndicator),
			delegate('.js-mark-visible-as-read', 'submit', markVisibleNotificationsRead)
		);
	} else if (pageDetect.isPR() || pageDetect.isIssue()) {
		await markRead(location.href);

		// The sidebar changes when new comments are added or the issue status changes
		observeEl('.discussion-sidebar', addMarkUnreadButton);
	} else if (pageDetect.isDiscussionList()) {
		for (const discussion of await getNotifications()) {
			const {pathname} = new URL(discussion.url);
			const listItem = select(`.read [href='${pathname}']`);
			if (listItem) {
				listItem.closest('.read')!.classList.replace('read', 'unread');
			}
		}
	}

	updateUnreadIndicator();
}

features.add({
	id: 'mark-unread',
	description: 'Mark any issues and pull requests as unread',
	load: features.onAjaxedPagesRaw,
	init
});
